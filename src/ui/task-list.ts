/**
 * TaskList component - renders grouped tasks
 */

import { App } from 'obsidian';

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
}

export interface TaskListOptions {
  /** Show task count in file headers */
  showTaskCount?: boolean;
  /** Show file path instead of just name */
  showFullPath?: boolean;
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
      ...options
    };
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
    this.container.empty();

    if (this.groups.length === 0) {
      this.renderEmpty();
      return;
    }

    for (const group of this.groups) {
      this.renderGroup(group);
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
   * Render a file group
   */
  private renderGroup(group: TaskGroup): void {
    const groupEl = this.container.createDiv({ cls: 'taskbase-group' });

    // Header
    const headerEl = groupEl.createDiv({ cls: 'taskbase-group-header' });

    // File name
    const nameEl = headerEl.createSpan({ cls: 'taskbase-group-name' });
    const displayName = this.options.showFullPath
      ? group.filePath.replace(/\.md$/, '')
      : group.fileName;
    nameEl.setText(displayName);

    // Task count
    if (this.options.showTaskCount) {
      const countEl = headerEl.createSpan({ cls: 'taskbase-group-count' });
      countEl.setText(`${group.tasks.length}`);
    }

    // Click handler
    headerEl.addEventListener('click', () => {
      this.callbacks.onFileClick(group.filePath);
    });

    // Task list
    const listEl = groupEl.createEl('ul', { cls: 'taskbase-task-list' });

    for (const task of group.tasks) {
      this.renderTask(listEl, task);
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

    // Task text
    const textEl = contentEl.createSpan({ cls: 'taskbase-task-text' });
    textEl.setText(task.$text);

    // Click handler for text
    contentEl.addEventListener('click', () => {
      this.callbacks.onTaskClick(task);
    });

    // Render nested tasks recursively (hierarchical display)
    if (task.$elements && task.$elements.length > 0) {
      const nestedList = itemEl.createEl('ul', { cls: 'taskbase-task-list taskbase-nested' });
      for (const child of task.$elements) {
        // Only render task children (not plain list items)
        if (this.isTask(child)) {
          this.renderTask(nestedList, child);
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
   * Destroy and clean up
   */
  destroy(): void {
    this.container.empty();
    this.groups = [];
  }
}
