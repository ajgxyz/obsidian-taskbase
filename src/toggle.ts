/**
 * Task toggle service - handles task completion write-back
 */

import { App, TFile } from 'obsidian';

// ============================================================================
// Types
// ============================================================================

/**
 * Minimal task interface for toggle operation
 * Matches Datacore's MarkdownTaskItem shape
 */
export interface ToggleableTask {
  /** Path to containing file */
  $file: string;
  /** 0-indexed line number */
  $line: number;
  /** Current completion status */
  $completed: boolean;
}

export interface ToggleResult {
  success: boolean;
  error?: string;
  newStatus?: boolean;
}

// ============================================================================
// Checkbox Regex
// ============================================================================

/**
 * Matches markdown checkbox pattern at start of line
 * Groups: (1) leading whitespace + marker (2) checkbox char (3) rest of line
 *
 * Examples matched:
 * - [ ] Task
 * - [x] Task
 * * [ ] Task
 * + [x] Task
 *   - [ ] Indented task
 */
const CHECKBOX_REGEX = /^(\s*[-*+]\s*\[)([ xX])(\].*)/;

// ============================================================================
// Toggle Implementation
// ============================================================================

/**
 * Toggle a task's completion status
 *
 * @param app - Obsidian App instance
 * @param task - Task to toggle (needs $file, $line, $completed)
 * @returns Result with success status and any error
 */
export async function toggleTask(app: App, task: ToggleableTask): Promise<ToggleResult> {
  // Get file
  const abstractFile = app.vault.getAbstractFileByPath(task.$file);

  if (!abstractFile) {
    return {
      success: false,
      error: `File not found: ${task.$file}`
    };
  }

  if (!(abstractFile instanceof TFile)) {
    return {
      success: false,
      error: `Not a file: ${task.$file}`
    };
  }

  const file = abstractFile;
  const newStatus = !task.$completed;
  const newMarker = newStatus ? 'x' : ' ';

  try {
    await app.vault.process(file, (content) => {
      const lines = content.split('\n');

      // Validate line number
      if (task.$line < 0 || task.$line >= lines.length) {
        throw new Error(`Invalid line number: ${task.$line}`);
      }

      const line = lines[task.$line];
      if (line === undefined) {
        throw new Error(`Invalid line number: ${task.$line}`);
      }
      const match = line.match(CHECKBOX_REGEX);

      if (!match) {
        throw new Error(`Line ${task.$line} is not a checkbox`);
      }

      // Replace checkbox marker
      lines[task.$line] = `${match[1]}${newMarker}${match[3]}`;

      return lines.join('\n');
    });

    return {
      success: true,
      newStatus
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('TaskBase: Failed to toggle task:', message);
    return {
      success: false,
      error: message
    };
  }
}

/**
 * Batch toggle multiple tasks
 *
 * Note: Each toggle is independent. If one fails, others still proceed.
 *
 * @param app - Obsidian App instance
 * @param tasks - Tasks to toggle
 * @returns Array of results matching input order
 */
export async function toggleTasks(
  app: App,
  tasks: ToggleableTask[]
): Promise<ToggleResult[]> {
  // Process sequentially to avoid race conditions on same file
  const results: ToggleResult[] = [];

  for (const task of tasks) {
    const result = await toggleTask(app, task);
    results.push(result);
  }

  return results;
}

/**
 * Set a task to a specific completion status
 *
 * @param app - Obsidian App instance
 * @param task - Task to modify
 * @param completed - Desired completion status
 * @returns Result with success status
 */
export async function setTaskStatus(
  app: App,
  task: ToggleableTask,
  completed: boolean
): Promise<ToggleResult> {
  // If already in desired state, no-op
  if (task.$completed === completed) {
    return {
      success: true,
      newStatus: completed
    };
  }

  return toggleTask(app, task);
}
