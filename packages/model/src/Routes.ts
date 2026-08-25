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
 * disambiguation.
 *
 * @remarks
 * The ONE canonical implementation. This docstring made that claim before it
 * was true: the RSPress adapter carried a second, subtly different sanitizer
 * for page-side `id=` attributes (it kept `_`, being in `\w`, and mapped `$`
 * to `-`), so `get_value` was linked as `#get-value` and rendered as
 * `id="get_value"` — a cross-link that landed nowhere. Both sides call this
 * now. Do not add a second spelling; if page ids ever genuinely need
 * different treatment from route anchors, that is a design change, not a
 * local helper.
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

/**
 * Which slot a class member occupies. Two members may share a display name
 * while occupying different slots (a `static create()` beside an instance
 * `create()`), which is what {@link memberAnchors} disambiguates.
 *
 * @public
 */
export type MemberSlot = "static-property" | "static-method" | "instance-property" | "instance-method" | "getter";

/**
 * One class member, identified for anchor computation.
 *
 * @public
 */
export interface MemberRef {
	/**
	 * Caller-supplied stable identity, unique per member. An API Extractor
	 * `canonicalReference` is the natural choice: it already distinguishes a
	 * static member from an instance member of the same name (`Foo.bar` vs
	 * `Foo#bar`), so the caller never has to re-derive that distinction.
	 */
	readonly id: string;
	/** The member's display name, as written in the source. */
	readonly displayName: string;
	/** The slot the member occupies. */
	readonly slot: MemberSlot;
}

/**
 * The anchor for a single member, given an already-decided prefix.
 *
 * @remarks
 * A thin alias over {@link sanitizeId} that names the intent at the call site.
 * Prefer {@link memberAnchors} when rendering a whole class — deciding the
 * prefix per member is the part that is easy to get wrong.
 *
 * @public
 */
export function memberAnchor(displayName: string, prefix: string = ""): string {
	return sanitizeId(displayName, prefix);
}

/**
 * Slots ordered by which keeps the bare anchor when names collide.
 *
 * @remarks
 * Static slots lead because the bare cross-link key `Class.member` canonically
 * means the static member (see {@link memberRouteKeys}). One naming decision
 * applied to both halves: the name that resolves to a member is the name that
 * member's anchor uses.
 */
const SLOT_PRIORITY: readonly MemberSlot[] = [
	"static-method",
	"static-property",
	"instance-method",
	"getter",
	"instance-property",
];

/**
 * The prefix a losing slot is disambiguated with.
 *
 * @remarks
 * The prefix marks the NON-canonical side, so an instance member displaced by
 * a static one becomes `instance-create`. TypeScript forbids two members of
 * one class sharing a name within the same static-ness, so in practice a
 * collision is exactly one static and one instance member and only
 * `"instance"` is ever emitted; the static entries are a total-map fallback.
 */
const SLOT_PREFIX: Readonly<Record<MemberSlot, string>> = {
	"static-method": "static",
	"static-property": "static",
	"instance-method": "instance",
	getter: "instance",
	"instance-property": "instance",
};

/**
 * Compute the anchor for every member of one class, keyed by
 * {@link MemberRef.id}.
 *
 * @remarks
 * When several members sanitize to the same anchor, the highest-priority slot
 * keeps the bare anchor and every other member is prefixed
 * (`instance-create`). Priority runs static method, static property, instance
 * method, getter, instance property — static first, so the anchor agrees with
 * the bare cross-link key, which resolves to the static member.
 *
 * The per-MEMBER keying is load-bearing. A previous implementation keyed the
 * prefix by sanitized NAME, so both halves of a `static create()` / `create()`
 * collision looked up the same entry and both rendered
 * `id="static-create"` — two elements sharing one HTML id, and the instance
 * member displaced from the anchor its cross-link pointed at. Keying by
 * member means the loser moves and the winner does not.
 *
 * @public
 */
export function memberAnchors(members: readonly MemberRef[]): ReadonlyMap<string, string> {
	const bySanitized = new Map<string, MemberRef[]>();
	for (const member of members) {
		const base = sanitizeId(member.displayName);
		const bucket = bySanitized.get(base);
		if (bucket) bucket.push(member);
		else bySanitized.set(base, [member]);
	}

	const anchors = new Map<string, string>();
	for (const bucket of bySanitized.values()) {
		const winner =
			bucket.length === 1
				? bucket[0]
				: [...bucket].sort((a, b) => SLOT_PRIORITY.indexOf(a.slot) - SLOT_PRIORITY.indexOf(b.slot))[0];
		for (const member of bucket) {
			const prefix = member === winner ? "" : SLOT_PREFIX[member.slot];
			anchors.set(member.id, memberAnchor(member.displayName, prefix));
		}
	}
	return anchors;
}

/** Static slots, for the `:static` / `:instance` selector split. */
const STATIC_SLOTS: ReadonlySet<MemberSlot> = new Set<MemberSlot>(["static-property", "static-method"]);

/**
 * Cross-link keys for one class's members, mapped to the member they resolve
 * to ({@link MemberRef.id}).
 *
 * @remarks
 * The bare `Class.member` key resolves to the STATIC member when a class has
 * both a static and an instance member of that name. `Registry.create` is the
 * static access expression in TypeScript — the instance one is
 * `registry.create` — so a prose author writing the qualified form means the
 * static member.
 *
 * The disambiguating keys use TSDoc declaration-reference selectors, the
 * vocabulary API Extractor canonical references already carry:
 *
 * - `Registry.create` — the static member (the common case)
 * - `Registry.(create:instance)` — the instance member
 * - `Registry.(create:static)` — the static member, explicitly
 * - `Registry.prototype.create` — an alias for the instance member; real
 *   JavaScript rather than invented syntax, and what a reader guesses
 *
 * `Class#member` is deliberately NOT emitted. `#` is the URL fragment
 * delimiter, so such a key reads ambiguously beside a route, and in modern
 * TypeScript `#` denotes a PRIVATE field (`this.#count`) — the JSDoc
 * convention predates both and has aged badly.
 *
 * Selector keys are emitted ONLY when a collision exists. On the
 * overwhelmingly common class with no name collision the bare key is
 * complete, and every extra key is one more pattern the prose cross-linker
 * compiles and tests against every string it links.
 *
 * @public
 */
export function memberRouteKeys(className: string, members: readonly MemberRef[]): ReadonlyMap<string, string> {
	const byName = new Map<string, MemberRef[]>();
	for (const member of members) {
		const bucket = byName.get(member.displayName);
		if (bucket) bucket.push(member);
		else byName.set(member.displayName, [member]);
	}

	const keys = new Map<string, string>();
	for (const [displayName, bucket] of byName) {
		const statics = bucket.filter((m) => STATIC_SLOTS.has(m.slot));
		const instances = bucket.filter((m) => !STATIC_SLOTS.has(m.slot));
		const collides = statics.length > 0 && instances.length > 0;

		// Static wins the bare key; with no static member the instance takes it.
		const bare = statics[0] ?? instances[0];
		if (bare) keys.set(`${className}.${displayName}`, bare.id);
		if (!collides) continue;

		const staticMember = statics[0];
		const instanceMember = instances[0];
		if (staticMember) keys.set(`${className}.(${displayName}:static)`, staticMember.id);
		if (instanceMember) {
			keys.set(`${className}.(${displayName}:instance)`, instanceMember.id);
			keys.set(`${className}.prototype.${displayName}`, instanceMember.id);
		}
	}
	return keys;
}
