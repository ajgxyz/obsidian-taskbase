/**
 * TaskList component - renders grouped tasks
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
// Component
// ============================================================================

export class TaskList {
  private app: App;
  private container: HTMLElement;
  private callbacks: TaskListCallbacks;
  private options: TaskListOptions;

  private groups: TaskGroup[] = [];
  private collapsedGroups: Set<string>;
  private component: Component;

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
    this.component = new Component();
    this.component.load();
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

  /**
   * Render the task list
   */
  private render(): void {
    this.component.unload();
    this.component = new Component();
    this.component.load();

    // Preserve scroll position across re-renders (the scrollable element is the parent .taskbase-view)
    const scrollParent = this.container.parentElement;
    const scrollTop = scrollParent?.scrollTop ?? 0;

    this.container.empty();

    if (this.groups.length === 0) {
      this.renderEmpty();
      return;
    }

    for (const group of this.groups) {
      this.renderGroup(group);
    }

    if (scrollParent) {
      scrollParent.scrollTop = scrollTop;
    }
  }

  /**
   * Render empty state
   */
  private renderEmpty(): void {
    const emptyEl = this.container.createDiv({ cls: 'taskbase-empty' });

    const iconEl = emptyEl.createDiv({ cls: 'taskbase-empty-icon' });
    this.renderCheckIcon(iconEl);

    const textEl = emptyEl.createDiv({ cls: 'taskbase-empty-text' });
    textEl.setText('No tasks found');

    const hintEl = emptyEl.createDiv({ cls: 'taskbase-empty-hint' });
    hintEl.setText('Adjust your filters or add tasks to matching files');
  }

  /**
   * Render check circle icon using DOM API (avoids innerHTML)
   */
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

  /**
   * Render chevron icon using DOM API (avoids innerHTML)
   */
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
   * Render a file group
   */
  private renderGroup(group: TaskGroup): void {
    const isCollapsed = this.collapsedGroups.has(group.filePath);
    const groupEl = this.container.createDiv({ cls: 'taskbase-group' });

    if (isCollapsed) {
      groupEl.addClass('is-collapsed');
    }

    // Header
    const headerEl = groupEl.createDiv({ cls: 'taskbase-group-header' });

    // Toggle button
    const toggleEl = headerEl.createEl('button', {
      cls: 'taskbase-group-toggle',
      attr: {
        'aria-label': isCollapsed ? 'Expand group' : 'Collapse group',
        'aria-expanded': String(!isCollapsed)
      }
    });
    this.renderChevronIcon(toggleEl);

    // Toggle click handler
    toggleEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const newCollapsed = !this.collapsedGroups.has(group.filePath);
      if (newCollapsed) {
        this.collapsedGroups.add(group.filePath);
      } else {
        this.collapsedGroups.delete(group.filePath);
      }
      this.callbacks.onGroupToggle?.(group.filePath, newCollapsed);
      this.render();
    });

    // File name (clickable to open file)
    const nameEl = headerEl.createSpan({ cls: 'taskbase-group-name' });
    const displayName = this.options.showFullPath
      ? group.filePath.replace(/\.md$/, '')
      : group.fileName;
    nameEl.setText(displayName);

    // File click handler
    nameEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onFileClick(group.filePath);
    });

    // Task count
    if (this.options.showTaskCount) {
      const countEl = headerEl.createSpan({ cls: 'taskbase-group-count' });
      countEl.setText(`${group.tasks.length}`);
    }

    // Task list (only render if not collapsed)
    if (!isCollapsed) {
      const listEl = groupEl.createEl('ul', { cls: 'taskbase-task-list' });

      for (const task of group.tasks) {
        this.renderTask(listEl, task);
      }
    }
  }

  /**
   * Render a single task (and its children recursively)
   * See [[Research - Nested Tasks Behavior]] for hierarchy details
   */
  private renderTask(container: HTMLElement, task: TaskItem): void {
    const itemEl = container.createEl('li', { cls: 'taskbase-task' });

    if (task.$completed) {
      itemEl.addClass('is-completed');
    }

    // Row container for checkbox + content (allows nested list to flow below)
    const rowEl = itemEl.createDiv({ cls: 'taskbase-task-row' });

    // Checkbox wrapper (for better click target)
    const checkboxWrapper = rowEl.createDiv({ cls: 'taskbase-checkbox-wrapper' });

    // Checkbox with accessibility label
    const checkboxEl = checkboxWrapper.createEl('input', {
      type: 'checkbox',
      cls: 'taskbase-checkbox',
      attr: {
        'aria-label': `Toggle task: ${task.$text.substring(0, 50)}`
      }
    });
    checkboxEl.checked = task.$completed;

    // Prevent double-firing
    checkboxEl.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    checkboxEl.addEventListener('change', () => {
      this.callbacks.onToggle(task);
    });

    // Task content
    const contentEl = rowEl.createDiv({ cls: 'taskbase-task-content' });

    // Task text — render inline markdown (bold, italic, links)
    const textEl = contentEl.createSpan({ cls: 'taskbase-task-text' });
    void MarkdownRenderer.render(
      this.app, task.$text, textEl, task.$file, this.component
    );
    this.attachLinkHandler(textEl, task.$file);

    // Click handler for text (only fires if click wasn't on a link)
    contentEl.addEventListener('click', () => {
      this.callbacks.onTaskClick(task);
    });

    // Render nested children recursively (hierarchical display)
    if (task.$elements && task.$elements.length > 0) {
      const nestedList = itemEl.createEl('ul', { cls: 'taskbase-task-list taskbase-nested' });
      for (const child of task.$elements) {
        if (this.isTask(child)) {
          this.renderTask(nestedList, child);
        } else if (this.options.showBullets) {
          this.renderListItem(nestedList, child);
        }
      }
    }
  }

  /**
   * Render a plain list item (bullet point, no checkbox)
   */
  private renderListItem(container: HTMLElement, item: TaskItem): void {
    const itemEl = container.createEl('li', { cls: 'taskbase-list-item' });

    const rowEl = itemEl.createDiv({ cls: 'taskbase-task-row' });

    // Bullet marker instead of checkbox
    const markerEl = rowEl.createDiv({ cls: 'taskbase-bullet-marker' });
    markerEl.setText('\u2022');

    // Content — render inline markdown (bold, italic, links)
    const contentEl = rowEl.createDiv({ cls: 'taskbase-task-content' });
    const textEl = contentEl.createSpan({ cls: 'taskbase-task-text' });
    void MarkdownRenderer.render(
      this.app, item.$text, textEl, item.$file, this.component
    );
    this.attachLinkHandler(textEl, item.$file);

    contentEl.addEventListener('click', () => {
      this.callbacks.onTaskClick(item);
    });

    // Render nested children recursively
    if (item.$elements && item.$elements.length > 0) {
      const nestedList = itemEl.createEl('ul', { cls: 'taskbase-task-list taskbase-nested' });
      for (const child of item.$elements) {
        if (this.isTask(child)) {
          this.renderTask(nestedList, child);
        } else if (this.options.showBullets) {
          this.renderListItem(nestedList, child);
        }
      }
    }
  }

  /**
   * Check if a list item is a task (has checkbox)
   */
  private isTask(item: TaskItem): boolean {
    return typeof item.$completed === 'boolean';
  }

  /**
   * Update showBullets option
   */
  setShowBullets(value: boolean): void {
    this.options.showBullets = value;
  }

  /**
   * Attach click handler to rendered links so they open targets
   * instead of triggering the parent task-click handler.
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
        // External link — open in browser
        window.open(href, '_blank');
      } else if (this.callbacks.onLinkClick) {
        // Delegate internal link navigation to the view
        this.callbacks.onLinkClick(href, sourcePath);
      } else {
        // Fallback — open via Obsidian directly
        void this.app.workspace.openLinkText(href, sourcePath);
      }
    });
  }

  /**
   * Extract file name from path
   */
  private extractFileName(filePath: string): string {
    const parts = filePath.split('/');
    const fileName = parts[parts.length - 1] || filePath;
    return fileName.replace(/\.md$/, '');
  }

  /**
   * Get total task count (including nested tasks)
   */
  getTaskCount(): number {
    let count = 0;
    for (const group of this.groups) {
      count += this.countTasksRecursive(group.tasks);
    }
    return count;
  }

  /**
   * Recursively count tasks including nested children
   */
  private countTasksRecursive(tasks: TaskItem[]): number {
    let count = 0;
    for (const task of tasks) {
      count++; // Count this task
      if (task.$elements && task.$elements.length > 0) {
        // Count nested tasks
        const nestedTasks = task.$elements.filter(item => this.isTask(item));
        count += this.countTasksRecursive(nestedTasks);
      }
    }
    return count;
  }

  /**
   * Get file count
   */
  getFileCount(): number {
    return this.groups.length;
  }

  /**
   * Collapse all groups
   */
  collapseAll(): void {
    for (const group of this.groups) {
      this.collapsedGroups.add(group.filePath);
    }
    this.callbacks.onCollapseAll?.();
    this.render();
  }

  /**
   * Expand all groups
   */
  expandAll(): void {
    this.collapsedGroups.clear();
    this.callbacks.onExpandAll?.();
    this.render();
  }

  /**
   * Get current collapsed groups
   */
  getCollapsedGroups(): string[] {
    return Array.from(this.collapsedGroups);
  }

  /**
   * Update collapsed groups from external source
   */
  setCollapsedGroups(groups: string[]): void {
    this.collapsedGroups = new Set(groups);
  }

  /**
   * Destroy and clean up
   */
  destroy(): void {
    this.component.unload();
    this.container.empty();
    this.groups = [];
  }
}
