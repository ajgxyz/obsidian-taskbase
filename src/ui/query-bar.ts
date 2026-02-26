/**
 * QueryBar component - single text input for Datacore page conditions
 */

import { TextComponent } from 'obsidian';

// ============================================================================
// Constants
// ============================================================================

const DEBOUNCE_MS = 600;

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
  private debounceTimer?: number;
  private lastEmittedQuery = '';

  constructor(container: HTMLElement, callbacks: QueryBarCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.render();
  }

  /**
   * Sync input value from external config change (e.g. file reload).
   * Skips update if the incoming query matches what we last emitted,
   * to avoid clobbering in-progress edits during save round-trips.
   */
  update(query: string): void {
    if (query === this.lastEmittedQuery) {
      return; // echo suppression
    }
    this.lastEmittedQuery = query;
    this.input?.setValue(query);
  }

  destroy(): void {
    if (this.debounceTimer) {
      window.clearTimeout(this.debounceTimer);
    }
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
    this.input.onChange((value) => {
      this.scheduleEmit(value);
    });
  }

  // ============================================================================
  // Change Emission
  // ============================================================================

  private scheduleEmit(query: string): void {
    if (this.debounceTimer) {
      window.clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = window.setTimeout(() => {
      this.emitChange(query);
    }, DEBOUNCE_MS);
  }

  private emitChange(query: string): void {
    const trimmed = query.trim();
    this.lastEmittedQuery = trimmed;
    this.callbacks.onQueryChange(trimmed);
  }
}
