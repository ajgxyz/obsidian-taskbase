/**
 * QueryBar component - single text input for Datacore page conditions
 *
 * Commits changes only on Enter. Escape reverts to the last-saved query.
 */

import { TextComponent } from 'obsidian';

// ============================================================================
// Types
// ============================================================================

export interface QueryBarCallbacks {
  onQueryChange: (query: string) => void;
}

// ============================================================================
// Component
// ============================================================================

export class QueryBar {
  private container: HTMLElement;
  private callbacks: QueryBarCallbacks;
  private input: TextComponent | null = null;
  /** The persisted query value (what's saved in the .taskbase file) */
  private savedQuery = '';

  constructor(container: HTMLElement, callbacks: QueryBarCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.render();
  }

  /**
   * Sync input value from external config change (e.g. file reload).
   * Always updates the saved baseline and the visible input.
   */
  update(query: string): void {
    this.savedQuery = query;
    this.input?.setValue(query);
    this.updateDirtyState();
  }

  destroy(): void {
    this.container.empty();
    this.input = null;
  }

  // ============================================================================
  // Render
  // ============================================================================

  private render(): void {
    this.container.empty();

    this.container.createSpan({
      cls: 'taskbase-query-label',
      text: 'Filter',
    });

    const wrapper = this.container.createDiv({ cls: 'taskbase-query-input-wrapper' });

    this.input = new TextComponent(wrapper);
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- example query syntax, not UI label
    this.input.setPlaceholder('path("Projects") and status = "active"');
    this.input.inputEl.classList.add('taskbase-query-input');

    // Commit on Enter, revert on Escape
    this.input.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.revert();
      }
    });

    // Track dirty state on every keystroke for visual feedback
    this.input.inputEl.addEventListener('input', () => {
      this.updateDirtyState();
    });
  }

  // ============================================================================
  // Commit / Revert
  // ============================================================================

  private commit(): void {
    const value = this.input?.getValue().trim() ?? '';
    if (value === this.savedQuery) return; // No change
    this.savedQuery = value;
    this.updateDirtyState();
    this.input?.inputEl.blur();
    this.callbacks.onQueryChange(value);
  }

  private revert(): void {
    this.input?.setValue(this.savedQuery);
    this.updateDirtyState();
    this.input?.inputEl.blur();
  }

  // ============================================================================
  // Dirty State
  // ============================================================================

  private updateDirtyState(): void {
    const current = this.input?.getValue().trim() ?? '';
    const isDirty = current !== this.savedQuery;
    this.input?.inputEl.classList.toggle('is-dirty', isDirty);
  }
}
