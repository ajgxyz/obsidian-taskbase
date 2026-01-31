import { Plugin, Notice } from "obsidian";
import { TaskBaseView, VIEW_TYPE_TASKBASE } from "./view";

// ============================================================================
// Datacore Type Declarations
// ============================================================================

/**
 * Opaque event reference for Datacore subscriptions
 */
type EventRef = object;

/**
 * Datacore API exposed via window.datacore
 * See [[TaskBase Technical Specification]] section 1.1 for full structure
 */
declare global {
	interface Window {
		datacore?: {
			/** Core instance for events and state */
			core: {
				initialized: boolean;
				on: (event: string, callback: () => void) => EventRef;
				offref: (ref: EventRef) => void;
			};
			/** Execute a query and return results */
			query: (query: string) => unknown[];
			/** Execute a query and return Result<results, error> */
			tryQuery: (query: string) => { ok: boolean; value?: unknown[]; error?: string };
		};
	}
}

// ============================================================================
// Plugin Implementation
// ============================================================================

export default class TaskBasePlugin extends Plugin {
	private datacoreReady = false;
	private initRef?: EventRef;

	async onload(): Promise<void> {
		console.debug("TaskBase: Loading plugin");

		// Register view type
		this.registerView(
			VIEW_TYPE_TASKBASE,
			(leaf) => new TaskBaseView(leaf, this),
		);

		// Register .taskbase extension
		this.registerExtensions(["taskbase"], VIEW_TYPE_TASKBASE);

		// Wait for workspace, then connect to Datacore
		this.app.workspace.onLayoutReady(() => {
			this.connectDatacore();
		});
	}

	private connectDatacore(): void {
		const dc = window.datacore;
		if (!dc) {
			new Notice("Datacore plugin is required");
			console.error("TaskBase: Datacore not found");
			return;
		}

		if (dc.core.initialized) {
			this.onDatacoreReady();
		} else {
			this.initRef = dc.core.on("initialized", () => this.onDatacoreReady());
		}
	}

	private onDatacoreReady(): void {
		this.datacoreReady = true;
		console.debug("TaskBase: Datacore ready");
	}

	isDatacoreReady(): boolean {
		return this.datacoreReady;
	}

	onunload(): void {
		console.debug("TaskBase: Unloading plugin");
		if (window.datacore && this.initRef) {
			window.datacore.core.offref(this.initRef);
		}
	}
}
