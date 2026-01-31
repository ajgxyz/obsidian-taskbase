/**
 * Query builder - transforms config into Datacore query strings
 */

import type {
	TaskBaseSource,
	TaskBaseViewConfig,
	PropertyFilter,
} from "./config";

// ============================================================================
// Value Formatting
// ============================================================================

/**
 * Format a filter value for Datacore syntax
 */
export function formatValue(value: string): string {
	// Date keywords
	if (value === "today" || value === "now") {
		return `date(${value})`;
	}

	// ISO date format (YYYY-MM-DD)
	if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return `date(${value})`;
	}

	// Tags - wrap in quotes
	if (value.startsWith("#")) {
		return `"${value}"`;
	}

	// Boolean
	if (value === "true" || value === "false") {
		return value;
	}

	// Number
	if (/^-?\d+(\.\d+)?$/.test(value)) {
		return value;
	}

	// Default: string, wrap in quotes
	// Escape any internal quotes
	return `"${value.replace(/"/g, '\\"')}"`;
}

// ============================================================================
// Filter Building
// ============================================================================

/**
 * Build a single filter expression
 */
export function buildFilterExpression(filter: PropertyFilter): string {
	const value = formatValue(filter.value);

	if (filter.operator === "contains") {
		// Special syntax for contains
		return `${filter.property}.contains(${value})`;
	}

	// Standard comparison
	return `${filter.property} ${filter.operator} ${value}`;
}

/**
 * Build the page-level query (file filters)
 */
export function buildPageQuery(source: TaskBaseSource): string {
	const conditions: string[] = [];

	// Folder filter
	if (source.folder && source.folder.trim()) {
		// Escape quotes in folder path
		const escapedFolder = source.folder.replace(/"/g, '\\"');
		conditions.push(`path("${escapedFolder}")`);
	}

	// Property filters
	for (const filter of source.filters) {
		conditions.push(buildFilterExpression(filter));
	}

	// Combine conditions
	if (conditions.length === 0) {
		return "@page";
	}

	return `@page and ${conditions.join(" and ")}`;
}

/**
 * Build the complete task query
 */
export function buildQuery(
	source: TaskBaseSource,
	view: TaskBaseViewConfig,
): string {
	const pageQuery = buildPageQuery(source);

	// Base task query
	let taskQuery = `@task and childof(${pageQuery})`;

	// Task-level filter: hide completed
	if (!view.showCompleted) {
		taskQuery += " and $completed = false";
	}

	return taskQuery;
}

// ============================================================================
// Debug Helpers
// ============================================================================

/**
 * Parse a query back into components (for debugging)
 */
export function describeQuery(query: string): string[] {
	const parts: string[] = [];

	if (query.includes("@task")) {
		parts.push("Queries tasks");
	}

	const childofMatch = query.match(/childof\(([^)]+)\)/);
	if (childofMatch) {
		parts.push(`From pages matching: ${childofMatch[1]}`);
	}

	if (query.includes("$completed = false")) {
		parts.push("Excludes completed tasks");
	}

	return parts;
}
