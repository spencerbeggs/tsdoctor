/**
 * The package's currency type: a virtual file system mapping
 * `node_modules/`-prefixed paths to file contents.
 */

/**
 * A virtual file system: file paths (prefixed `node_modules/<package>/`)
 * mapped to their string contents.
 *
 * @remarks
 * This is the value every loading operation produces and every TypeScript
 * integration consumes. Maps from multiple packages merge with {@link mergeVfs};
 * `@typescript/vfs` consumes the merged map directly (see `TsEnvironment`).
 *
 * @public
 */
export type Vfs = Map<string, string>;

/**
 * Merge VFS maps left to right into a new map; later entries win on path
 * collisions.
 *
 * @example
 * ```ts
 * import { mergeVfs } from "@tsdoctor/vfs";
 *
 * const combined = mergeVfs(vfsA, vfsB);
 * ```
 *
 * @public
 */
export const mergeVfs = (...maps: ReadonlyArray<ReadonlyMap<string, string>>): Vfs => {
	const out: Vfs = new Map();
	for (const map of maps) {
		for (const [path, content] of map) {
			out.set(path, content);
		}
	}
	return out;
};

/**
 * Prefix every path in `entries` with `node_modules/<name>/`, normalizing
 * away leading slashes.
 *
 * @public
 */
export const prefixVfs = (name: string, entries: ReadonlyMap<string, string>): Vfs => {
	const out: Vfs = new Map();
	for (const [path, content] of entries) {
		out.set(`node_modules/${name}/${path.replace(/^\/+/, "")}`, content);
	}
	return out;
};

/**
 * Whether a path names a TypeScript declaration file.
 *
 * @remarks
 * The single spelling of this predicate. `TsEnvironment` uses it to pick a
 * VFS map's root files, and `@tsdoctor/registry`'s module resolution uses it
 * to decide whether a resolved path is a declaration. Two spellings of "is
 * this a `.d.ts`" would be free to drift, and the drift would be silent — a
 * root file quietly missing from a TypeScript environment degrades hovers
 * without producing an error.
 *
 * @public
 */
export const isTypeDefinition = (filePath: string): boolean =>
	filePath.endsWith(".d.ts") || filePath.endsWith(".d.mts") || filePath.endsWith(".d.cts");
