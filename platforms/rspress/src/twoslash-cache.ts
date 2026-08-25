import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { TwoslashTypesCache } from "@shikijs/twoslash";

/**
 * Persisted Twoslash result cache.
 *
 * Type-checking code blocks is by far the dominant cost of the render phase —
 * measured at ~97% of it, concentrated in the minority of blocks that carry an
 * `@example` (see `render-phase-instrumentation.md`). `@shikijs/twoslash`
 * exposes a first-class `typesCache` seam for exactly this, so the work here is
 * a keying scheme and a store rather than a new interception point.
 *
 * ## Soundness
 *
 * A Twoslash result depends on three things: the code, the compiler options,
 * and the whole type environment the code is checked against. The key covers
 * all three — the per-entry key is the code, and the environment is folded into
 * the blob's identity via {@link twoslashEnvHash}. A cached result can
 * therefore never be served against a type environment that would produce a
 * different answer.
 *
 * ## Invalidation granularity
 *
 * The consequence of that soundness is coarse invalidation: any VFS change
 * discards the whole generation, because a declaration change anywhere can
 * legitimately change any block's inferred types. So this cache makes repeat
 * builds over an UNCHANGED API nearly free — CI re-runs, prose-only edits,
 * theme and config changes, rebuilding a site without touching the library —
 * and does nothing for the build right after an API item changes.
 *
 * Sharpening that would need per-scope type environments, so one package's
 * change stops invalidating every other package's blocks. That is fix (b) in
 * `render-phase-instrumentation.md`, tracked as a correctness fix; it would
 * make this cache substantially more effective on a multi-API site as a side
 * effect.
 *
 * ## Synchronous by necessity
 *
 * `TwoslashTypesCache.read`/`write` are synchronous — they are called from
 * inside Shiki's `preprocess` hook. Persistence is therefore load-once at
 * startup and save-once at the end, against an in-memory map; there is no
 * per-entry I/O. See `TwoslashCacheService`.
 */

/**
 * Bumped when the stored shape changes, so an older blob is treated as absent
 * rather than deserialized into the wrong shape.
 */
export const TWOSLASH_CACHE_FORMAT = 1;

/** The subset of a Twoslash run that Shiki consumes, and all this cache stores. */
export interface TwoslashCacheValue {
	readonly nodes: unknown;
	readonly code: string;
	readonly meta?: { readonly extension?: string };
}

export interface TwoslashCacheStats {
	readonly hits: number;
	readonly misses: number;
	/** Entries currently held, including those loaded from a previous build. */
	readonly entries: number;
	/** True when at least one entry was written this build. */
	readonly dirty: boolean;
}

export interface TwoslashResultCache extends TwoslashTypesCache {
	readonly stats: () => TwoslashCacheStats;
	readonly entries: () => ReadonlyMap<string, TwoslashCacheValue>;
}

function sha256(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}

/**
 * Fingerprint the type environment a generation is checked against.
 *
 * Hashed over sorted `path\0content` pairs so the digest is stable against map
 * iteration order. Compiler options are deliberately NOT folded in here: since
 * scopes may be documented under different configurations, they belong on the
 * per-entry key instead, so one generation can hold results from several
 * configurations without them colliding.
 */
export function twoslashEnvHash(vfs: ReadonlyMap<string, string>): string {
	const hash = createHash("sha256");
	hash.update(`format:${TWOSLASH_CACHE_FORMAT}\0`);
	for (const key of [...vfs.keys()].sort()) {
		// NUL-delimited: a path or its content containing a space must not be able
		// to collide with a different path/content split at the same total length.
		hash.update(`${key}\0${vfs.get(key) ?? ""}\0`);
	}
	return hash.digest("hex");
}

/** JSON with object keys sorted, so equivalent options hash identically. */
function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * Per-entry key: the code, its language, and the compiler configuration it is
 * checked under.
 *
 * The configuration matters because two APIs on one site may be documented
 * under different `tsconfig`s — the same source checked under different options
 * can produce different types, so it must not share a cache entry.
 */
export function twoslashEntryKey(code: string, lang: string | undefined, compilerOptions?: unknown): string {
	return sha256(`${lang ?? "ts"}\0${stableStringify(compilerOptions ?? {})}\0${code}`);
}

/**
 * The cache key a whole generation is stored under. One blob per environment,
 * so a changed environment reads as a miss rather than serving stale results.
 */
export function twoslashBlobKey(envHash: string): string {
	return `twoslash/v${TWOSLASH_CACHE_FORMAT}/${envHash}`;
}

/**
 * Build a synchronous Twoslash cache over an in-memory map, optionally seeded
 * with entries loaded from a previous build.
 */
export function makeTwoslashCache(initial?: ReadonlyMap<string, TwoslashCacheValue>): TwoslashResultCache {
	const map = new Map<string, TwoslashCacheValue>(initial);
	let hits = 0;
	let misses = 0;
	let dirty = false;

	return {
		// `options` is the twoslashOptions Shiki hands the twoslasher, carrying the
		// environment's compilerOptions — so the cache is configuration-aware
		// without the call sites having to thread anything through.
		read: (code, lang, options) => {
			const found = map.get(twoslashEntryKey(code, lang, options?.compilerOptions));
			if (found === undefined) {
				misses += 1;
				return null;
			}
			hits += 1;
			// Shiki's TwoslashShikiReturn; stored verbatim as plain JSON data.
			return found as never;
		},
		write: (code, data, lang, options) => {
			const value: TwoslashCacheValue = {
				nodes: (data as { nodes: unknown }).nodes,
				code: data.code,
				...(data.meta?.extension != null ? { meta: { extension: data.meta.extension } } : {}),
			};
			map.set(twoslashEntryKey(code, lang, options?.compilerOptions), value);
			dirty = true;
		},
		stats: () => ({ hits, misses, entries: map.size, dirty }),
		entries: () => map,
	};
}

/** Serialize a generation for storage. Gzipped JSON — hover text compresses well. */
export function encodeTwoslashCache(entries: ReadonlyMap<string, TwoslashCacheValue>): Uint8Array {
	return gzipSync(Buffer.from(JSON.stringify(Object.fromEntries(entries)), "utf-8"));
}

/**
 * Deserialize a stored generation.
 *
 * Returns an empty map for anything unreadable — a truncated blob, a format
 * change, a corrupted file. A cache that cannot be read is a cache miss, never
 * a build failure.
 */
export function decodeTwoslashCache(blob: Uint8Array): Map<string, TwoslashCacheValue> {
	try {
		const parsed: unknown = JSON.parse(gunzipSync(blob).toString("utf-8"));
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
		return new Map(Object.entries(parsed as Record<string, TwoslashCacheValue>));
	} catch {
		return new Map();
	}
}
