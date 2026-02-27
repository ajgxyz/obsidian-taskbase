/**
 * TaskList component - renders grouped tasks with diff-based DOM updates
 *
 * Instead of tearing down and rebuilding the entire DOM on every refresh,
 * this component tracks existing DOM nodes and only updates what changed.
 * For the common case (checkbox toggle), this means flipping one class and
 * one checkbox — no markdown re-rendering, no DOM teardown.
 */

import { App, Component, MarkdownRenderer } from 'obsidian';

// ============================================================================
// Types
// ============================================================================

export interface TaskItem {
  $file: string;
  $line: number;
  $completed: boolean;
  $text: string;
  /** Parent line: negative = root task, positive = nested under parent */
  $parentLine: number;
  /** Child tasks for hierarchical rendering */
  $elements: TaskItem[];
}

export interface TaskGroup {
  filePath: string;
  fileName: string;
  tasks: TaskItem[];
}

export interface TaskListCallbacks {
  /** Called when task checkbox is toggled */
  onToggle: (task: TaskItem) => void;
  /** Called when task text is clicked */
  onTaskClick: (task: TaskItem) => void;
  /** Called when file header is clicked */
  onFileClick: (filePath: string) => void;
  /** Called when an internal link is clicked */
  onLinkClick?: (href: string, sourcePath: string) => void;
  /** Called when a group is collapsed/expanded */
  onGroupToggle?: (filePath: string, collapsed: boolean) => void;
  /** Called when "Collapse All" is clicked */
  onCollapseAll?: () => void;
  /** Called when "Expand All" is clicked */
  onExpandAll?: () => void;
}

export interface TaskListOptions {
  /** Show task count in file headers */
  showTaskCount?: boolean;
  /** Show file path instead of just name */
  showFullPath?: boolean;
  /** Set of file paths that are collapsed */
  collapsedGroups?: Set<string>;
  /** Show bullet points (non-task list items) as children */
  showBullets?: boolean;
}

// ============================================================================
// Internal State Tracking
// ============================================================================

/** Tracks a single task or bullet item's DOM nodes and data for diffing */
interface TaskNodeState {
  el: HTMLElement;
  /** Mutable reference to current task data — event handlers read from this */
  task: TaskItem;
  completed: boolean;
  text: string;
  checkboxEl: HTMLInputElement | null;
  textEl: HTMLElement;
  /** Per-item component for MarkdownRenderer lifecycle */
  markdownComponent: Component;
  childListEl: HTMLElement | null;
  childNodes: Map<number, TaskNodeState>;
  isBullet: boolean;
}

/** Tracks a file group's DOM nodes and child task states */
interface GroupNodeState {
  el: HTMLElement;
  toggleEl: HTMLElement;
  countEl: HTMLElement | null;
  listEl: HTMLElement | null;
  collapsed: boolean;
  taskNodes: Map<number, TaskNodeState>;
}

// ============================================================================
// Component
// ============================================================================

export class TaskList {
  private app: App;
  private container: HTMLElement;
  private callbacks: TaskListCallbacks;
  private options: TaskListOptions;

  private groups: TaskGroup[] = [];
  private collapsedGroups: Set<string>;

  /** Keyed group DOM state for diff-based updates */
  private groupNodes = new Map<string, GroupNodeState>();

  constructor(
    app: App,
    container: HTMLElement,
    callbacks: TaskListCallbacks,
    options: TaskListOptions = {}
  ) {
    this.app = app;
    this.container = container;
    this.callbacks = callbacks;
    this.options = {
      showTaskCount: true,
      showFullPath: false,
      showBullets: false,
      ...options
    };
    this.collapsedGroups = options.collapsedGroups ?? new Set();
  }

  /**
   * Update the task list with new grouped data
   */
  update(groups: Array<[string, TaskItem[]]>): void {
    // Transform to TaskGroup format
    this.groups = groups.map(([filePath, tasks]) => ({
      filePath,
      fileName: this.extractFileName(filePath),
      tasks
    }));

    this.render();
  }

  // ============================================================================
  // Diff-based Rendering
  // ============================================================================

  /**
   * Render the task list using diff-based DOM updates.
   * Reuses existing DOM nodes where possible, only updating what changed.
   */
  private render(): void {
    // Preserve scroll position (the scrollable element is the parent .taskbase-view)
    const scrollParent = this.container.parentElement;
    const scrollTop = scrollParent?.scrollTop ?? 0;

    if (this.groups.length === 0) {
      this.clearAllNodes();
      this.container.empty();
      this.renderEmpty();
      return;
    }

    // Remove empty state if present
    this.container.querySelector('.taskbase-empty')?.remove();

    // Remove groups that no longer exist
    const currentPaths = new Set(this.groups.map(g => g.filePath));
    for (const [path, node] of this.groupNodes) {
      if (!currentPaths.has(path)) {
        this.destroyGroupNode(node);
        this.groupNodes.delete(path);
      }
    }

    // Update existing groups or create new ones
    for (const group of this.groups) {
      const existing = this.groupNodes.get(group.filePath);
      if (existing) {
        this.updateGroupNode(existing, group);
      } else {
        const node = this.createGroupNode(group);
        this.groupNodes.set(group.filePath, node);
      }
    }

    // Ensure DOM order matches data order (appendChild moves existing elements)
    for (const group of this.groups) {
      const node = this.groupNodes.get(group.filePath);
      if (node) {
        this.container.appendChild(node.el);
      }
    }

    if (scrollParent) {
      scrollParent.scrollTop = scrollTop;
    }
  }

  // ============================================================================
  // Group Nodes
  // ============================================================================

  private createGroupNode(group: TaskGroup): GroupNodeState {
    const isCollapsed = this.collapsedGroups.has(group.filePath);
    const el = document.createElement('div');
    el.className = 'taskbase-group';
    if (isCollapsed) el.classList.add('is-collapsed');

    // Header
    const headerEl = el.createDiv({ cls: 'taskbase-group-header' });

    // Toggle button
    const toggleEl = headerEl.createEl('button', {
      cls: 'taskbase-group-toggle',
      attr: {
        'aria-label': isCollapsed ? 'Expand group' : 'Collapse group',
        'aria-expanded': String(!isCollapsed)
      }
    });
    this.renderChevronIcon(toggleEl);

    const filePath = group.filePath;
    toggleEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const newCollapsed = !this.collapsedGroups.has(filePath);
      if (newCollapsed) {
        this.collapsedGroups.add(filePath);
      } else {
        this.collapsedGroups.delete(filePath);
      }
      this.callbacks.onGroupToggle?.(filePath, newCollapsed);
      this.render();
    });

    // File name
    const nameEl = headerEl.createSpan({ cls: 'taskbase-group-name' });
    const displayName = this.options.showFullPath
      ? filePath.replace(/\.md$/, '')
      : group.fileName;
    nameEl.setText(displayName);

    nameEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onFileClick(filePath);
    });

    // Task count
    let countEl: HTMLElement | null = null;
    if (this.options.showTaskCount) {
      countEl = headerEl.createSpan({ cls: 'taskbase-group-count' });
      countEl.setText(`${group.tasks.length}`);
    }

    // Task list (only if expanded)
    const taskNodes = new Map<number, TaskNodeState>();
    let listEl: HTMLElement | null = null;
    if (!isCollapsed) {
      listEl = el.createEl('ul', { cls: 'taskbase-task-list' });
      for (const task of group.tasks) {
        const taskNode = this.createTaskNode(listEl, task);
        taskNodes.set(task.$line, taskNode);
      }
    }

    return { el, toggleEl, countEl, listEl, collapsed: isCollapsed, taskNodes };
  }

  private updateGroupNode(node: GroupNodeState, group: TaskGroup): void {
    const isCollapsed = this.collapsedGroups.has(group.filePath);

    // Handle collapse/expand state change
    if (isCollapsed !== node.collapsed) {
      node.collapsed = isCollapsed;
      if (isCollapsed) {
        node.el.classList.add('is-collapsed');
        if (node.listEl) {
          for (const [, taskNode] of node.taskNodes) {
            this.destroyTaskNode(taskNode);
          }
          node.taskNodes.clear();
          node.listEl.remove();
          node.listEl = null;
        }
      } else {
        node.el.classList.remove('is-collapsed');
        node.listEl = node.el.createEl('ul', { cls: 'taskbase-task-list' });
        for (const task of group.tasks) {
          const taskNode = this.createTaskNode(node.listEl, task);
          node.taskNodes.set(task.$line, taskNode);
        }
      }
      node.toggleEl.setAttribute('aria-label', isCollapsed ? 'Expand group' : 'Collapse group');
      node.toggleEl.setAttribute('aria-expanded', String(!isCollapsed));
    }

    // Update count
    if (node.countEl) {
      node.countEl.setText(`${group.tasks.length}`);
    }

    // Diff tasks (only if expanded)
    if (!isCollapsed && node.listEl) {
      this.diffTaskList(node.listEl, node.taskNodes, group.tasks);
    }
  }

  private destroyGroupNode(node: GroupNodeState): void {
    for (const [, taskNode] of node.taskNodes) {
      this.destroyTaskNode(taskNode);
    }
    node.el.remove();
  }

  // ============================================================================
  // Task Node Diffing
  // ============================================================================

  private diffTaskList(
    listEl: HTMLElement,
    taskNodes: Map<number, TaskNodeState>,
    tasks: TaskItem[]
  ): void {
    // Remove tasks that no longer exist
    const currentLines = new Set(tasks.map(t => t.$line));
    for (const [line, taskNode] of taskNodes) {
      if (!currentLines.has(line)) {
        this.destroyTaskNode(taskNode);
        taskNodes.delete(line);
      }
    }

    // Update existing or create new tasks
    for (const task of tasks) {
      const existing = taskNodes.get(task.$line);
      if (existing) {
        this.updateTaskNode(existing, task);
      } else {
        const taskNode = this.createTaskNode(listEl, task);
        taskNodes.set(task.$line, taskNode);
      }
    }

    // Ensure DOM order matches data order
    for (const task of tasks) {
      const taskNode = taskNodes.get(task.$line);
      if (taskNode) {
        listEl.appendChild(taskNode.el);
      }
    }
  }

  // ============================================================================
  // Task Nodes
  // ============================================================================

  private createTaskNode(container: HTMLElement, task: TaskItem): TaskNodeState {
    const isBullet = !this.isTask(task);
    const el = container.createEl('li', { cls: isBullet ? 'taskbase-list-item' : 'taskbase-task' });

    if (!isBullet && task.$completed) {
      el.classList.add('is-completed');
    }

    const rowEl = el.createDiv({ cls: 'taskbase-task-row' });

    // State object — event handlers capture this mutable reference
    const markdownComponent = new Component();
    markdownComponent.load();
    const state: TaskNodeState = {
      el, task, completed: task.$completed, text: task.$text,
      checkboxEl: null, textEl: null!,
      markdownComponent,
      childListEl: null, childNodes: new Map(), isBullet
    };

    if (isBullet) {
      const markerEl = rowEl.createDiv({ cls: 'taskbase-bullet-marker' });
      markerEl.setText('\u2022');
    } else {
      const checkboxWrapper = rowEl.createDiv({ cls: 'taskbase-checkbox-wrapper' });
      const checkboxEl: HTMLInputElement = checkboxWrapper.createEl('input', {
        type: 'checkbox',
        cls: 'taskbase-checkbox',
        attr: { 'aria-label': `Toggle task: ${task.$text.substring(0, 50)}` }
      });
      checkboxEl.checked = task.$completed;
      checkboxEl.addEventListener('click', (e) => e.stopPropagation());
      // Handler reads state.task so it always has the latest data
      checkboxEl.addEventListener('change', () => this.callbacks.onToggle(state.task));
      state.checkboxEl = checkboxEl;
    }

    // Content
    const contentEl = rowEl.createDiv({ cls: 'taskbase-task-content' });
    const textEl = contentEl.createSpan({ cls: 'taskbase-task-text' });
    state.textEl = textEl;
    void MarkdownRenderer.render(this.app, task.$text, textEl, task.$file, markdownComponent);
    this.attachLinkHandler(textEl, task.$file);

    contentEl.addEventListener('click', () => this.callbacks.onTaskClick(state.task));

    // Nested children
    const children = this.getVisibleChildren(task);
    if (children.length > 0) {
      state.childListEl = el.createEl('ul', { cls: 'taskbase-task-list taskbase-nested' });
      for (const child of children) {
        const childNode = this.createTaskNode(state.childListEl, child);
        state.childNodes.set(child.$line, childNode);
      }
    }

    return state;
  }

  private updateTaskNode(node: TaskNodeState, task: TaskItem): void {
    // Update task reference so event handlers see latest data
    node.task = task;

    // Update completed state (checkbox + CSS class)
    if (!node.isBullet && task.$completed !== node.completed) {
      node.completed = task.$completed;
      if (task.$completed) {
        node.el.classList.add('is-completed');
      } else {
        node.el.classList.remove('is-completed');
      }
      if (node.checkboxEl) {
        node.checkboxEl.checked = task.$completed;
      }
    }

    // Re-render markdown only if text actually changed
    if (task.$text !== node.text) {
      node.text = task.$text;
      node.markdownComponent.unload();
      node.markdownComponent = new Component();
      node.markdownComponent.load();
      node.textEl.empty();
      void MarkdownRenderer.render(
        this.app, task.$text, node.textEl, task.$file, node.markdownComponent
      );
      // Link handler is on textEl itself using event delegation — still works
    }

    // Diff children
    const children = this.getVisibleChildren(task);
    if (children.length > 0) {
      if (!node.childListEl) {
        node.childListEl = node.el.createEl('ul', { cls: 'taskbase-task-list taskbase-nested' });
      }
      this.diffTaskList(node.childListEl, node.childNodes, children);
    } else if (node.childListEl) {
      for (const [, childNode] of node.childNodes) {
        this.destroyTaskNode(childNode);
      }
      node.childNodes.clear();
      node.childListEl.remove();
      node.childListEl = null;
    }
  }

  private destroyTaskNode(node: TaskNodeState): void {
    node.markdownComponent.unload();
    for (const [, child] of node.childNodes) {
      this.destroyTaskNode(child);
    }
    node.el.remove();
  }

  private clearAllNodes(): void {
    for (const [, groupNode] of this.groupNodes) {
      this.destroyGroupNode(groupNode);
    }
    this.groupNodes.clear();
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private getVisibleChildren(task: TaskItem): TaskItem[] {
    if (!task.$elements || task.$elements.length === 0) return [];
    return task.$elements.filter(child => this.isTask(child) || this.options.showBullets);
  }

  private isTask(item: TaskItem): boolean {
    return typeof item.$completed === 'boolean';
  }

  // ============================================================================
  // Static Rendering (empty state, icons)
  // ============================================================================

  private renderEmpty(): void {
    const emptyEl = this.container.createDiv({ cls: 'taskbase-empty' });

    const iconEl = emptyEl.createDiv({ cls: 'taskbase-empty-icon' });
    this.renderCheckIcon(iconEl);

    const textEl = emptyEl.createDiv({ cls: 'taskbase-empty-text' });
    textEl.setText('No tasks found');

    const hintEl = emptyEl.createDiv({ cls: 'taskbase-empty-hint' });
    hintEl.setText('Adjust your filters or add tasks to matching files');
  }

  private renderCheckIcon(container: HTMLElement): void {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '48');
    svg.setAttribute('height', '48');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M22 11.08V12a10 10 0 1 1-5.93-9.14');
    svg.appendChild(path);

    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', '22 4 12 14.01 9 11.01');
    svg.appendChild(polyline);

    container.appendChild(svg);
  }

  private renderChevronIcon(container: HTMLElement): void {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.classList.add('taskbase-chevron');

    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', '9 18 15 12 9 6');
    svg.appendChild(polyline);

    container.appendChild(svg);
  }

  /**
   * Attach click handler to rendered links so they open targets
   * instead of triggering the parent task-click handler.
   * Uses event delegation so it works across markdown re-renders.
   */
  private attachLinkHandler(textEl: HTMLElement, sourcePath: string): void {
    textEl.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('a');
      if (!target) return;

      e.preventDefault();
      e.stopPropagation();

      const href = target.getAttribute('data-href') ?? target.getAttribute('href');
      if (!href) return;

      if (href.startsWith('http://') || href.startsWith('https://')) {
        window.open(href, '_blank');
      } else if (this.callbacks.onLinkClick) {
        this.callbacks.onLinkClick(href, sourcePath);
      } else {
        void this.app.workspace.openLinkText(href, sourcePath);
      }
    });
  }

  private extractFileName(filePath: string): string {
    const parts = filePath.split('/');
    const fileName = parts[parts.length - 1] || filePath;
    return fileName.replace(/\.md$/, '');
  }

  // ============================================================================
  // Public API
  // ============================================================================

  setShowBullets(value: boolean): void {
    this.options.showBullets = value;
  }

  getTaskCount(): number {
    let count = 0;
    for (const group of this.groups) {
      count += this.countTasksRecursive(group.tasks);
    }
    return count;
  }

  private countTasksRecursive(tasks: TaskItem[]): number {
    let count = 0;
    for (const task of tasks) {
      count++;
      if (task.$elements && task.$elements.length > 0) {
        const nestedTasks = task.$elements.filter(item => this.isTask(item));
        count += this.countTasksRecursive(nestedTasks);
      }
    }
    return count;
  }

  getFileCount(): number {
    return this.groups.length;
  }

  collapseAll(): void {
    for (const group of this.groups) {
      this.collapsedGroups.add(group.filePath);
    }
    this.callbacks.onCollapseAll?.();
    this.render();
  }

  expandAll(): void {
    this.collapsedGroups.clear();
    this.callbacks.onExpandAll?.();
    this.render();
  }

  getCollapsedGroups(): string[] {
    return Array.from(this.collapsedGroups);
  }

  setCollapsedGroups(groups: string[]): void {
    this.collapsedGroups = new Set(groups);
  }

  destroy(): void {
    this.clearAllNodes();
    this.container.empty();
    this.groups = [];
  }
}
