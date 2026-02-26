/**
 * TaskBase configuration types and parsing
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Supported filter operators
 */
export type FilterOperator = "=" | "!=" | "<" | "<=" | ">" | ">=" | "contains";

/**
 * A single property filter
 */
export interface PropertyFilter {
	/** Frontmatter field or implicit property ($tags, $mtime, etc.) */
	property: string;
	/** Comparison operator */
	operator: FilterOperator;
	/** Literal value or keyword (today, now) */
	value: string;
}

/**
 * Source configuration - defines which files to query
 */
export interface TaskBaseSource {
	/** Raw Datacore page conditions (e.g. `path("Projects") and status = "active"`) */
	query?: string;
	/** Optional folder path to limit scope (legacy) */
	folder?: string;
	/** Property-based filters (legacy) */
	filters: PropertyFilter[];
}

/**
 * View configuration - display options
 */
export interface TaskBaseViewConfig {
	/** Whether to include completed tasks */
	showCompleted: boolean;
	/** Sort field: 'file' | 'mtime' | 'ctime' | property name */
	sortBy: string;
	/** Sort direction */
	sortDirection: "asc" | "desc";
	/** File paths of collapsed groups */
	collapsedGroups?: string[];
	/** Whether to show bullet points as child items */
	showBullets?: boolean;
}

/**
 * Complete .taskbase file configuration
 */
export interface TaskBaseConfig {
	/** Schema version for future compatibility */
	version: number;
	/** File selection criteria */
	source: TaskBaseSource;
	/** Display options */
	view: TaskBaseViewConfig;
}

// ============================================================================
// Defaults
// ============================================================================

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: TaskBaseConfig = {
	version: 1,
	source: {
		filters: [],
	},
	view: {
		showCompleted: false,
		sortBy: "file",
		sortDirection: "desc",
		collapsedGroups: [],
		showBullets: false,
	},
};

// ============================================================================
// Validation
// ============================================================================

const VALID_OPERATORS: FilterOperator[] = [
	"=",
	"!=",
	"<",
	"<=",
	">",
	">=",
	"contains",
];
const VALID_SORT_DIRECTIONS = ["asc", "desc"] as const;

/**
 * Validates a filter object
 */
function isValidFilter(filter: unknown): filter is PropertyFilter {
	if (typeof filter !== "object" || filter === null) return false;
	const f = filter as Record<string, unknown>;
	return (
		typeof f.property === "string" &&
		f.property.length > 0 &&
		typeof f.operator === "string" &&
		VALID_OPERATORS.includes(f.operator as FilterOperator) &&
		typeof f.value === "string"
	);
}

/**
 * Validates a source object
 */
function isValidSource(source: unknown): source is TaskBaseSource {
	if (typeof source !== "object" || source === null) return false;
	const s = source as Record<string, unknown>;

	// query is optional but must be string if present
	if (s.query !== undefined && typeof s.query !== "string") return false;

	// folder is optional but must be string if present
	if (s.folder !== undefined && typeof s.folder !== "string") return false;

	// filters must be an array
	if (!Array.isArray(s.filters)) return false;

	// each filter must be valid
	return s.filters.every(isValidFilter);
}

/**
 * Validates a view config object
 */
function isValidViewConfig(view: unknown): view is TaskBaseViewConfig {
	if (typeof view !== "object" || view === null) return false;
	const v = view as Record<string, unknown>;

	// Required fields
	if (typeof v.showCompleted !== "boolean") return false;
	if (typeof v.sortBy !== "string") return false;
	if (typeof v.sortDirection !== "string") return false;
	if (!VALID_SORT_DIRECTIONS.includes(v.sortDirection as "asc" | "desc"))
		return false;

	// Optional collapsedGroups: must be string array if present
	if (v.collapsedGroups !== undefined) {
		if (!Array.isArray(v.collapsedGroups)) return false;
		if (!v.collapsedGroups.every((g) => typeof g === "string")) return false;
	}

	// Optional showBullets: must be boolean if present
	if (v.showBullets !== undefined && typeof v.showBullets !== "boolean")
		return false;

	return true;
}

// ============================================================================
// Parsing
// ============================================================================

export interface ParseResult {
	success: boolean;
	config?: TaskBaseConfig;
	error?: string;
}

/**
 * Parse and validate a .taskbase JSON string
 */
export function parseConfig(content: string): ParseResult {
	// Parse JSON
	let data: unknown;
	try {
		data = JSON.parse(content);
	} catch (e) {
		return {
			success: false,
			error: `Invalid JSON: ${e instanceof Error ? e.message : "Parse error"}`,
		};
	}

	if (typeof data !== "object" || data === null) {
		return { success: false, error: "Config must be an object" };
	}

	const obj = data as Record<string, unknown>;

	// Validate version
	if (typeof obj.version !== "number" || obj.version < 1) {
		return { success: false, error: "Missing or invalid version" };
	}

	// Validate source
	if (!isValidSource(obj.source)) {
		return { success: false, error: "Invalid source configuration" };
	}

	// Validate view
	if (!isValidViewConfig(obj.view)) {
		return { success: false, error: "Invalid view configuration" };
	}

	return {
		success: true,
		config: {
			version: obj.version,
			source: obj.source,
			view: obj.view,
		},
	};
}

/**
 * Merge partial config with defaults
 */
export function mergeWithDefaults(
	partial: Partial<TaskBaseConfig>,
): TaskBaseConfig {
	return {
		version: partial.version ?? DEFAULT_CONFIG.version,
		source: {
			query: partial.source?.query,
			folder: partial.source?.folder ?? DEFAULT_CONFIG.source.folder,
			filters: partial.source?.filters ?? DEFAULT_CONFIG.source.filters,
		},
		view: {
			showCompleted:
				partial.view?.showCompleted ?? DEFAULT_CONFIG.view.showCompleted,
			sortBy: partial.view?.sortBy ?? DEFAULT_CONFIG.view.sortBy,
			sortDirection:
				partial.view?.sortDirection ?? DEFAULT_CONFIG.view.sortDirection,
			collapsedGroups:
				partial.view?.collapsedGroups ?? DEFAULT_CONFIG.view.collapsedGroups,
			showBullets:
				partial.view?.showBullets ?? DEFAULT_CONFIG.view.showBullets,
		},
	};
}

/**
 * Serialize config to JSON string
 */
export function serializeConfig(config: TaskBaseConfig): string {
	return JSON.stringify(config, null, 2);
}
