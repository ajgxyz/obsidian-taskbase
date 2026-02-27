import { Plugin, Notice } from "obsidian";
import { DEFAULT_CONFIG, serializeConfig } from "./config";
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

		// Register .taskbase extension.
		// Wrap in try/catch: registerExtensions throws if the extension is already
		// claimed (e.g. stale registration from a previous plugin load). If that
		// happens, force-unregister the stale mapping and retry.
		try {
			this.registerExtensions(["taskbase"], VIEW_TYPE_TASKBASE);
		} catch {
			// @ts-expect-error -- internal API, not in public type definitions
			// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
			this.app.viewRegistry.unregisterExtensions(["taskbase"]);
			this.registerExtensions(["taskbase"], VIEW_TYPE_TASKBASE);
		}

		// Register commands
		this.addCommand({
			id: "create-taskbase-file",
			name: "Create new TaskBase view",
			callback: () => this.createTaskBaseFile(),
		});

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

		this.onDatacoreReady();
	}

	private onDatacoreReady(): void {
		this.datacoreReady = true;
		console.debug("TaskBase: Datacore ready");
	}

	isDatacoreReady(): boolean {
		return this.datacoreReady;
	}

	private async createTaskBaseFile(): Promise<void> {
		const folder = this.app.fileManager.getNewFileParent("");
		let name = "Untitled.taskbase";
		let counter = 1;
		while (this.app.vault.getAbstractFileByPath(`${folder.path === "/" ? "" : folder.path + "/"}${name}`)) {
			name = `Untitled ${counter}.taskbase`;
			counter++;
		}
		const path = folder.path === "/" ? name : `${folder.path}/${name}`;
		const file = await this.app.vault.create(path, serializeConfig(DEFAULT_CONFIG));
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file);
	}

	onunload(): void {
		console.debug("TaskBase: Unloading plugin");
		if (window.datacore && this.initRef) {
			window.datacore.core.offref(this.initRef);
		}

		// Obsidian's public API has no unregisterExtensions. Without this,
		// the .taskbase extension stays registered in the viewRegistry after
		// plugin disable/reload, blocking re-registration on next load.
		// @ts-expect-error -- internal API, not in public type definitions
		// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
		this.app.viewRegistry.unregisterExtensions(["taskbase"]);
	}
}
