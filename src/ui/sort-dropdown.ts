/**
 * SortDropdown component - icon button that opens an Obsidian Menu for sort options
 *
 * Uses the same toolbar button styling as collapse/expand. On click, shows a
 * native Obsidian Menu with sort options. The active option gets a checkmark.
 */

import { Menu, setIcon } from 'obsidian';

// ============================================================================
// Types
// ============================================================================

export interface SortDropdownCallbacks {
  onSortChange: (sortBy: string, sortDirection: 'asc' | 'desc') => void;
}

interface SortOption {
  value: string;
  label: string;
  sortBy: string;
  sortDirection: 'asc' | 'desc';
}

// ============================================================================
// Constants
// ============================================================================

const SORT_OPTIONS: SortOption[] = [
  { value: 'mtime-desc', label: 'Modified (New → Old)', sortBy: 'mtime', sortDirection: 'desc' },
  { value: 'mtime-asc',  label: 'Modified (Old → New)', sortBy: 'mtime', sortDirection: 'asc' },
  { value: 'ctime-desc', label: 'Created (New → Old)',  sortBy: 'ctime', sortDirection: 'desc' },
  { value: 'ctime-asc',  label: 'Created (Old → New)',  sortBy: 'ctime', sortDirection: 'asc' },
  { value: 'file-asc',   label: 'Title (A → Z)',        sortBy: 'file',  sortDirection: 'asc' },
  { value: 'file-desc',  label: 'Title (Z → A)',        sortBy: 'file',  sortDirection: 'desc' },
];

// ============================================================================
// Component
// ============================================================================

export class SortDropdown {
  private callbacks: SortDropdownCallbacks;
  private buttonEl: HTMLButtonElement | null = null;
  private currentValue = '';

  constructor(container: HTMLElement, callbacks: SortDropdownCallbacks) {
    this.callbacks = callbacks;
    this.render(container);
  }

  /**
   * Sync active sort from external config change (e.g. file reload).
   */
  update(sortBy: string, sortDirection: 'asc' | 'desc'): void {
    this.currentValue = `${sortBy}-${sortDirection}`;
  }

  destroy(): void {
    this.buttonEl?.remove();
    this.buttonEl = null;
  }

  // ============================================================================
  // Render
  // ============================================================================

  private render(container: HTMLElement): void {
    this.buttonEl = container.createEl('button', {
      cls: 'taskbase-toolbar-btn',
      attr: { 'aria-label': 'Sort order' },
    });
    setIcon(this.buttonEl, 'arrow-up-down');

    this.buttonEl.addEventListener('click', () => {
      this.showMenu();
    });
  }

  private showMenu(): void {
    if (!this.buttonEl) return;

    const menu = new Menu();

    for (const opt of SORT_OPTIONS) {
      menu.addItem((item) => {
        item
          .setTitle(opt.label)
          .setChecked(opt.value === this.currentValue)
          .onClick(() => {
            this.callbacks.onSortChange(opt.sortBy, opt.sortDirection);
          });
      });
    }

    const rect = this.buttonEl.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom });
  }
}
