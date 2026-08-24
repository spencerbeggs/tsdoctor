/**
 * Output-route computation: collision detection over route candidates and the
 * canonical anchor-id sanitizer. Detection is pure; the typed
 * {@link RouteCollisionError} is the artifact a consumer fails its build with.
 *
 * @packageDocumentation
 */

import { Schema } from "effect";

/**
 * A candidate output route for collision detection. All-string and
 * serializable — candidates cross the error boundary inside
 * {@link RouteCollisionError} and may be persisted by consumer diagnostics.
 *
 * @public
 */
export class RouteCandidate extends Schema.Class<RouteCandidate>("RouteCandidate")({
	/** Stable identity (e.g. `"displayName::kind"` or a namespace qualified name). */
	id: Schema.String,
	/** Human-readable name for error messages (original, non-lowercased). */
	displayName: Schema.String,
	/** Category folder name, e.g. `"variable"`. */
	folder: Schema.String,
	/** Lowercased sanitized last path segment, e.g. `"foo"` — the value used in the route. */
	baseName: Schema.String,
	/** API item kind string, e.g. `"Variable"`. */
	kind: Schema.String,
	/** canonicalReference string, used for deterministic ordering. */
	canonicalRef: Schema.String,
}) {}

/**
 * A set of distinct items that resolve to the same output route.
 *
 * @public
 */
export interface RouteCollision {
	/** The shared route key: `${folder}/${baseName}`. */
	readonly route: string;
	/** The distinct candidates that resolve to it (two or more). */
	readonly items: ReadonlyArray<RouteCandidate>;
}

/**
 * Group candidates by their final route (`${folder}/${baseName}`) and return
 * the groups with more than one distinct item. The route key is the lowercased
 * path the file is written to, so detection matches generation (and what a
 * case-insensitive filesystem would merge). Companion pairs (same name,
 * different folders) land under different keys and are never collisions.
 *
 * Output is deterministic: collisions ordered by route, items within a
 * collision ordered by canonicalReference.
 *
 * @public
 */
export function detectCollisions(candidates: ReadonlyArray<RouteCandidate>): RouteCollision[] {
	const byKey = new Map<string, RouteCandidate[]>();
	for (const candidate of candidates) {
		const key = `${candidate.folder}/${candidate.baseName}`;
		const group = byKey.get(key) ?? [];
		group.push(candidate);
		byKey.set(key, group);
	}

	const collisions: RouteCollision[] = [];
	for (const [route, group] of byKey) {
		if (group.length > 1) {
			const items = [...group].sort((a, b) =>
				a.canonicalRef < b.canonicalRef ? -1 : a.canonicalRef > b.canonicalRef ? 1 : 0,
			);
			collisions.push({ route, items });
		}
	}
	collisions.sort((a, b) => (a.route < b.route ? -1 : a.route > b.route ? 1 : 0));
	return collisions;
}

/**
 * Two or more distinct API items resolve to the same documentation route — a
 * naming or category-configuration problem the build must fail on. The
 * `message` names every colliding item with its kind and canonical reference,
 * plus remediation guidance.
 *
 * @public
 */
export class RouteCollisionError extends Schema.TaggedError<RouteCollisionError>()("RouteCollisionError", {
	baseRoute: Schema.String,
	collisions: Schema.Array(
		Schema.Struct({
			route: Schema.String,
			items: Schema.Array(RouteCandidate),
		}),
	),
}) {
	override get message(): string {
		const lines: string[] = [];
		for (const collision of this.collisions) {
			lines.push(
				`Route collision: ${collision.items.length} API items resolve to the same documentation path "${this.baseRoute}/${collision.route}":`,
			);
			for (const item of collision.items) {
				lines.push(`  - ${item.displayName} (${item.kind})  [${item.canonicalRef}]`);
			}
		}
		lines.push("");
		lines.push(
			"Item names must be unique per category folder. Paths are lowercased, so names differing only in case collide. Rename one of the items, or configure categories so they map to different folders.",
		);
		return lines.join("\n");
	}
}

/**
 * Sanitize a display name into a valid HTML anchor id: lowercase,
 * spaces/underscores → hyphens, other specials stripped, optional prefix for
 * disambiguation. The ONE canonical implementation — anchor generation and
 * cross-link routes must agree on it by construction.
 *
 * @public
 */
export function sanitizeId(displayName: string, prefix: string = ""): string {
	const sanitized = displayName
		.toLowerCase()
		.replace(/[\s_]+/g, "-")
		.replace(/[^a-z0-9-]/g, "")
		.replace(/^-+|-+$/g, "");
	return prefix ? `${prefix}-${sanitized}` : sanitized;
}
