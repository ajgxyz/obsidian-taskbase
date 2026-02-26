/**
 * TaskBaseView - Main view component for .taskbase files
 *
 * Extends TextFileView so Obsidian automatically handles file loading,
 * saving, and change detection for .taskbase JSON config files.
 */

import { TextFileView, WorkspaceLeaf } from 'obsidian';
import type TaskBasePlugin from './main';
import { parseConfig, serializeConfig, DEFAULT_CONFIG, type TaskBaseConfig } from './config';
import { buildQuery } from './query';
import { toggleTask, type ToggleableTask } from './toggle';
import { TaskList, type TaskItem } from './ui/task-list';

// ============================================================================
// Constants
// ============================================================================

export const VIEW_TYPE_TASKBASE = 'taskbase-view';
const DEBOUNCE_MS = 500;
const DATACORE_POLL_MS = 200;
const DATACORE_TIMEOUT_MS = 10_000;

// ============================================================================
// Types
// ============================================================================

/**
 * Opaque reference for Datacore events
 */
type EventRef = object;

// TaskItem is imported from ./ui/task-list
export type { TaskItem } from './ui/task-list';

// ============================================================================
// View Implementation
// ============================================================================

export class TaskBaseView extends TextFileView {
  private plugin: TaskBasePlugin;
  private config: TaskBaseConfig = DEFAULT_CONFIG;

  // Datacore subscription
  private updateRef?: EventRef;
  private debounceTimer?: number;
  private retryInterval?: number;
  private hasResults = false;

  // UI containers
  private loadingEl!: HTMLElement;
  private errorEl!: HTMLElement;
  private toolbarEl!: HTMLElement;
  private taskListEl!: HTMLElement;

  // Task list component
  private taskList: TaskList | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: TaskBasePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_TASKBASE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? 'Task view';
  }

  getIcon(): string {
    return 'check-square';
  }

  canAcceptExtension(extension: string): boolean {
    return extension === 'taskbase';
  }

  // ============================================================================
  // TextFileView Lifecycle
  // ============================================================================

  /**
   * Called by TextFileView when file content is loaded or changed externally.
   * @param data - The file content as a string
   * @param clear - true when opening a new file, false when file was modified externally
   */
  setViewData(data: string, clear: boolean): void {
    console.debug('TaskBase: setViewData called, clear:', clear);

    const result = parseConfig(data);
    if (!result.success) {
      this.showError(`Invalid config: ${result.error}`);
      return;
    }

    this.config = result.config!;

    if (clear) {
      // New file opened — disconnect old Datacore subscription
      this.disconnectDatacore();
    }

    this.connectDatacore();
  }

  /**
   * Called by TextFileView when saving — return current file contents.
   */
  getViewData(): string {
    return serializeConfig(this.config);
  }

  /**
   * Called when switching away from the current file.
   */
  clear(): void {
    this.disconnectDatacore();
    this.config = DEFAULT_CONFIG;
    this.hasResults = false;
    this.loadingEl?.show();
    this.errorEl?.hide();
    this.toolbarEl?.hide();
    this.taskListEl?.hide();
  }

  // ============================================================================
  // View Open / Close
  // ============================================================================

  async onOpen(): Promise<void> {
    // Set up container structure
    this.contentEl.empty();
    this.contentEl.addClass('taskbase-view');

    // Create UI sections
    this.loadingEl = this.contentEl.createDiv({ cls: 'taskbase-loading' });
    this.loadingEl.setText('Loading');

    this.errorEl = this.contentEl.createDiv({ cls: 'taskbase-error' });
    this.errorEl.hide();

    this.toolbarEl = this.contentEl.createDiv({ cls: 'taskbase-toolbar' });
    this.toolbarEl.hide();

    this.taskListEl = this.contentEl.createDiv({ cls: 'taskbase-list' });
    this.taskListEl.hide();

    // Initialize TaskList component
    this.taskList = new TaskList(
      this.app,
      this.taskListEl,
      {
        onToggle: (task) => { void this.handleToggle(task); },
        onTaskClick: (task) => this.handleTaskClick(task),
        onFileClick: (filePath) => this.handleFileClick(filePath),
        onGroupToggle: (filePath, collapsed) => this.handleGroupToggle(filePath, collapsed),
        onCollapseAll: () => this.handleCollapseAll(),
        onExpandAll: () => this.handleExpandAll()
      }
    );
  }

  async onClose(): Promise<void> {
    this.disconnectDatacore();

    // Clear timers
    this.clearRetryInterval();
    if (this.debounceTimer) {
      window.clearTimeout(this.debounceTimer);
    }

    // Clean up TaskList component
    this.taskList?.destroy();
    this.taskList = null;
  }

  // ============================================================================
  // Datacore Integration
  // ============================================================================

  private connectDatacore(): void {
    if (this.updateRef) return; // Already connected

    const dc = window.datacore;
    if (dc) {
      // Connect immediately — Datacore's query API works even during indexing.
      // We don't gate on dc.core.initialized because a Datacore bug with canvas
      // files can cause initialization to hang indefinitely.
      this.onDatacoreReady();
    }

    // Poll until we either find Datacore or get results.
    // On startup, Datacore may not exist yet (plugin load order) or may exist
    // but not have indexed files yet (update events may not fire reliably).
    // Keep polling until we have results, then stop.
    this.startRetryInterval();
  }

  private startRetryInterval(): void {
    if (this.retryInterval) return; // Already polling

    const started = Date.now();
    this.retryInterval = window.setInterval(() => {
      if (this.hasResults) {
        // Got results — stop polling
        this.clearRetryInterval();
        return;
      }

      const dc = window.datacore;
      if (dc) {
        if (!this.updateRef) {
          this.onDatacoreReady();
        } else {
          // Already subscribed but no results yet — re-query
          this.refresh();
        }
      } else if (Date.now() - started >= DATACORE_TIMEOUT_MS) {
        this.clearRetryInterval();
        this.showError('Datacore plugin is required');
      }
    }, DATACORE_POLL_MS);
  }

  private clearRetryInterval(): void {
    if (this.retryInterval) {
      window.clearInterval(this.retryInterval);
      this.retryInterval = undefined;
    }
  }

  private disconnectDatacore(): void {
    this.clearRetryInterval();
    if (this.updateRef && window.datacore) {
      window.datacore.core.offref(this.updateRef);
      this.updateRef = undefined;
    }
  }

  private onDatacoreReady(): void {
    if (this.updateRef) return; // Already connected

    // Subscribe to updates
    const dc = window.datacore;
    if (dc) {
      this.updateRef = dc.core.on('update', () => {
        this.scheduleRefresh();
      });
    }

    // Initial render
    this.refresh();
  }

  private scheduleRefresh(): void {
    if (this.debounceTimer) {
      window.clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = window.setTimeout(() => {
      this.refresh();
    }, DEBOUNCE_MS);
  }

  // ============================================================================
  // Query & Render
  // ============================================================================

  private refresh(): void {
    const dc = window.datacore;
    if (!dc) {
      return;
    }

    // Build and execute query
    const query = buildQuery(this.config.source, this.config.view);
    console.debug('TaskBase: Query:', query);

    let tasks: TaskItem[];
    try {
      tasks = dc.query(query) as TaskItem[];
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      console.error('TaskBase: Query failed:', message);
      this.showError(`Query failed: ${message}`);
      return;
    }

    // Group by file
    const grouped = this.groupByFile(tasks);

    // Sort groups
    const sortedGroups = this.sortGroups(grouped);

    // While still polling for Datacore to finish indexing, don't render
    // the empty state — keep showing "Loading" so the user sees progress.
    if (sortedGroups.length === 0 && this.retryInterval) {
      return;
    }

    // Render
    this.renderTaskList(sortedGroups);
  }

  private groupByFile(tasks: TaskItem[]): Map<string, TaskItem[]> {
    const groups = new Map<string, TaskItem[]>();

    for (const task of tasks) {
      // Only include root-level tasks (nested tasks are in $elements)
      // Root tasks have $parentLine < 0 (negated list start line)
      if (task.$parentLine >= 0) {
        continue; // Skip nested tasks - they'll be rendered via parent.$elements
      }

      const existing = groups.get(task.$file) || [];
      existing.push(task);
      groups.set(task.$file, existing);
    }

    // Sort tasks within each group by line number
    for (const [, fileTasks] of groups) {
      fileTasks.sort((a, b) => a.$line - b.$line);
    }

    return groups;
  }

  private sortGroups(groups: Map<string, TaskItem[]>): Array<[string, TaskItem[]]> {
    const entries = Array.from(groups.entries());
    const { sortBy, sortDirection } = this.config.view;
    const direction = sortDirection === 'asc' ? 1 : -1;

    entries.sort((a, b) => {
      if (sortBy === 'file') {
        return direction * a[0].localeCompare(b[0]);
      }
      return 0;
    });

    return entries;
  }

  // ============================================================================
  // Rendering
  // ============================================================================

  private renderTaskList(groups: Array<[string, TaskItem[]]>): void {
    if (groups.length > 0) {
      this.hasResults = true;
    }

    this.loadingEl.hide();
    this.errorEl.hide();
    this.toolbarEl.show();
    this.taskListEl.show();

    // Update collapsed groups from config
    this.taskList?.setCollapsedGroups(this.config.view.collapsedGroups ?? []);

    // Render toolbar
    this.renderToolbar();

    this.taskList?.update(groups);
  }

  private renderToolbar(): void {
    this.toolbarEl.empty();

    const collapseAllBtn = this.toolbarEl.createEl('button', {
      cls: 'taskbase-toolbar-btn',
      attr: { 'aria-label': 'Collapse all groups' }
    });
    collapseAllBtn.setText('Collapse all');
    collapseAllBtn.addEventListener('click', () => {
      this.taskList?.collapseAll();
    });

    const expandAllBtn = this.toolbarEl.createEl('button', {
      cls: 'taskbase-toolbar-btn',
      attr: { 'aria-label': 'Expand all groups' }
    });
    expandAllBtn.setText('Expand all');
    expandAllBtn.addEventListener('click', () => {
      this.taskList?.expandAll();
    });
  }

  // ============================================================================
  // Click Handlers
  // ============================================================================

  private handleTaskClick(task: TaskItem): void {
    void this.app.workspace.openLinkText(
      task.$file,
      '',
      false,
      { eState: { line: task.$line } }
    );
  }

  private handleFileClick(filePath: string): void {
    void this.app.workspace.openLinkText(filePath, '', false);
  }

  // ============================================================================
  // Task Toggle
  // ============================================================================

  private async handleToggle(task: TaskItem): Promise<void> {
    const toggleableTask: ToggleableTask = {
      $file: task.$file,
      $line: task.$line,
      $completed: task.$completed
    };

    const result = await toggleTask(this.app, toggleableTask);

    if (!result.success) {
      console.error('TaskBase: Toggle failed:', result.error);
      // Refresh to restore correct state
      this.refresh();
    }
    // Datacore will fire update event, triggering refresh
  }

  // ============================================================================
  // Collapse Handlers
  // ============================================================================

  private handleGroupToggle(filePath: string, collapsed: boolean): void {
    const set = new Set(this.config.view.collapsedGroups ?? []);
    if (collapsed) {
      set.add(filePath);
    } else {
      set.delete(filePath);
    }
    this.config.view.collapsedGroups = Array.from(set);
    void this.saveConfig();
  }

  private handleCollapseAll(): void {
    this.config.view.collapsedGroups = this.taskList?.getCollapsedGroups() ?? [];
    void this.saveConfig();
  }

  private handleExpandAll(): void {
    this.config.view.collapsedGroups = [];
    void this.saveConfig();
  }

  private async saveConfig(): Promise<void> {
    // Update this.data so TextFileView's save writes the correct content
    this.data = serializeConfig(this.config);
    this.requestSave();
  }

  // ============================================================================
  // Error Display
  // ============================================================================

  private showError(message: string): void {
    this.loadingEl.hide();
    this.toolbarEl.hide();
    this.taskListEl.hide();
    this.errorEl.show();
    this.errorEl.empty();
    this.errorEl.createSpan({ text: message });
  }
}
