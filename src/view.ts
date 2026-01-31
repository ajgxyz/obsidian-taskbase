/**
 * TaskBaseView - Main view component for .taskbase files
 */

import { ItemView, WorkspaceLeaf, TFile } from 'obsidian';
import type TaskBasePlugin from './main';
import { parseConfig, DEFAULT_CONFIG, type TaskBaseConfig } from './config';
import { buildQuery } from './query';
import { toggleTask, type ToggleableTask } from './toggle';
import { TaskList, type TaskItem } from './ui/task-list';

// ============================================================================
// Constants
// ============================================================================

export const VIEW_TYPE_TASKBASE = 'taskbase-view';
const DEBOUNCE_MS = 500;

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

export class TaskBaseView extends ItemView {
  private plugin: TaskBasePlugin;
  private config: TaskBaseConfig = DEFAULT_CONFIG;
  private configFile: TFile | null = null;

  // Datacore subscription
  private updateRef?: EventRef;
  private debounceTimer?: number;

  // UI containers
  private loadingEl!: HTMLElement;
  private errorEl!: HTMLElement;
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
    if (this.configFile) {
      return this.configFile.basename;
    }
    return 'Task view';
  }

  getIcon(): string {
    return 'check-square';
  }

  async onOpen(): Promise<void> {
    // Set up container structure
    this.contentEl.empty();
    this.contentEl.addClass('taskbase-view');

    // Create UI sections
    this.loadingEl = this.contentEl.createDiv({ cls: 'taskbase-loading' });
    this.loadingEl.setText('Loading');

    this.errorEl = this.contentEl.createDiv({ cls: 'taskbase-error' });
    this.errorEl.hide();

    this.taskListEl = this.contentEl.createDiv({ cls: 'taskbase-list' });
    this.taskListEl.hide();

    // Initialize TaskList component
    this.taskList = new TaskList(
      this.app,
      this.taskListEl,
      {
        onToggle: (task) => { void this.handleToggle(task); },
        onTaskClick: (task) => this.handleTaskClick(task),
        onFileClick: (filePath) => this.handleFileClick(filePath)
      }
    );

    // Load config from file
    await this.loadConfig();

    // Watch for config file changes
    this.registerConfigWatcher();

    // Wait for Datacore
    const dc = window.datacore;
    if (!dc) {
      this.showError('Datacore plugin is required');
      return;
    }

    if (!dc.core.initialized) {
      this.loadingEl.setText('Waiting for datacore to initialize');
      // Wait for initialization
      const initRef = dc.core.on('initialized', () => {
        dc.core.offref(initRef);
        this.onDatacoreReady();
      });
      return;
    }

    this.onDatacoreReady();
  }

  async onClose(): Promise<void> {
    // Clean up Datacore subscription
    if (this.updateRef && window.datacore) {
      window.datacore.core.offref(this.updateRef);
    }

    // Clear debounce timer
    if (this.debounceTimer) {
      window.clearTimeout(this.debounceTimer);
    }

    // Clean up TaskList component
    this.taskList?.destroy();
    this.taskList = null;

    // Clean up config watcher (handled by registerEvent automatically)
  }

  /**
   * Watch for changes to the config file and auto-reload
   */
  private registerConfigWatcher(): void {
    // Use registerEvent for automatic cleanup on view close
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (this.configFile && file.path === this.configFile.path) {
          void this.handleConfigChange();
        }
      })
    );
  }

  private async handleConfigChange(): Promise<void> {
    console.debug('TaskBase: Config file changed, reloading...');
    await this.loadConfig();
    this.refresh();
  }

  /**
   * Called when view file changes (e.g., file rename)
   */
  async onLoadFile(file: TFile): Promise<void> {
    this.configFile = file;
    await this.loadConfig();
    this.refresh();
  }

  // ============================================================================
  // Config Loading
  // ============================================================================

  private async loadConfig(): Promise<void> {
    // Get file from leaf state
    const state = this.leaf.getViewState();
    const filePath = state.state?.file as string | undefined;

    if (!filePath) {
      this.showError('No config file specified');
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) {
      this.showError(`Config file not found: ${filePath}`);
      return;
    }

    this.configFile = file;

    try {
      const content = await this.app.vault.read(file);
      const result = parseConfig(content);

      if (!result.success) {
        this.showError(`Invalid config: ${result.error}`);
        return;
      }

      this.config = result.config!;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      this.showError(`Failed to read config: ${message}`);
    }
  }

  // ============================================================================
  // Datacore Integration
  // ============================================================================

  private onDatacoreReady(): void {
    // Initial render
    this.refresh();

    // Subscribe to updates
    const dc = window.datacore;
    if (dc) {
      this.updateRef = dc.core.on('update', () => {
        this.scheduleRefresh();
      });
    }
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
    if (!dc || !dc.core.initialized) {
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
      // For now, sort by file path
      // TODO: Support mtime, ctime, custom properties
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
    this.loadingEl.hide();
    this.errorEl.hide();
    this.taskListEl.show();

    this.taskList?.update(groups);
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
  // Error Display
  // ============================================================================

  private showError(message: string): void {
    this.loadingEl.hide();
    this.taskListEl.hide();
    this.errorEl.show();
    this.errorEl.empty();
    this.errorEl.createSpan({ text: message });
  }
}
