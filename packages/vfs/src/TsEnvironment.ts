import type { CompilerOptions } from "@effected/tsconfig-json";
import type { VirtualTypeScriptEnvironment } from "@typescript/vfs";
import { Effect, Schema } from "effect";
import type { Vfs } from "./Vfs.js";
import { isTypeDefinition } from "./Vfs.js";

/**
 * Raised when building a virtual TypeScript environment fails — including
 * when the optional `typescript` / `@typescript/vfs` /
 * `@effected/tsconfig-json` peers are not installed.
 *
 * @public
 */
export class TsEnvironmentError extends Schema.TaggedError<TsEnvironmentError>()("TsEnvironmentError", {
	/** The underlying failure, preserved structurally. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return "Failed to create the virtual TypeScript environment";
	}
}

/**
 * Options for {@link TsEnvironment.make}.
 *
 * @public
 */
export interface TsEnvironmentOptions {
	/** The virtual file system to typecheck against. */
	readonly vfs: Vfs;
	/**
	 * Compiler options for the language service, in tsconfig JSON form
	 * (`{ target: "es2022" }`, not `ts.ScriptTarget.ES2022`). Enum-valued
	 * fields are converted to the compiler's numeric enums internally, so this
	 * type has no dependency on the `typescript` package.
	 */
	readonly compilerOptions: CompilerOptions.Type;
	/**
	 * The directory VFS paths are rooted under and the filesystem fallback
	 * root. Defaults to `process.cwd()` (which v3 hardcoded).
	 */
	readonly projectRoot?: string;
}

/**
 * The `@typescript/vfs` seam: builds a `VirtualTypeScriptEnvironment` over a
 * {@link Vfs} plus the TypeScript default lib files.
 *
 * @remarks
 * The ONLY module touching the optional `typescript` / `@typescript/vfs` /
 * `@effected/tsconfig-json` peers, and it loads all three lazily inside
 * {@link TsEnvironment.make} — a consumer that never calls it never loads
 * the compiler, and a missing peer fails typed as
 * {@link TsEnvironmentError} instead of crashing at import time. Keep every
 * one of them behind that dynamic `import()`: a static value import here is
 * reachable from `index.ts`, so it would turn an omitted optional peer into
 * an `ERR_MODULE_NOT_FOUND` on the entry graph for consumers who never
 * touch this module. Only the type-only `CompilerOptions` import is safe
 * statically, because it erases. The underlying `createDefaultMapFromNodeModules` /
 * `createFSBackedSystem` read the real filesystem through TypeScript's own
 * `sys`, outside the Effect `FileSystem` service — accepted and documented;
 * this module is why the package is integrated tier on its own surface.
 *
 * No cache map (v3's `createTypeScriptCache` returned a one-entry `Map`
 * keyed by `JSON.stringify(compilerOptions)`): a consumer that wants keyed
 * reuse holds its own map.
 *
 * `VirtualTypeScriptEnvironment` is deliberately not re-exported — import
 * the type from `@typescript/vfs`, which consumers of this module already
 * declare.
 *
 * @example
 * ```ts
 * import { TsEnvironment } from "@tsdoctor/vfs";
 *
 * const environment = TsEnvironment.make({
 *   vfs,
 *   compilerOptions: { strict: true, target: "es2022" },
 * });
 * ```
 *
 * @public
 */
export class TsEnvironment {
	private constructor() {}

	/** Build a `VirtualTypeScriptEnvironment` over a {@link Vfs}. */
	static make(options: TsEnvironmentOptions): Effect.Effect<VirtualTypeScriptEnvironment, TsEnvironmentError> {
		return Effect.gen(function* () {
			// Lazy imports: the peers are optional, so failing to load them is a
			// typed failure, not an import-time crash.
			const [tsModule, tsVfs, { TsEnumCodec }] = yield* Effect.tryPromise({
				try: () => Promise.all([import("typescript"), import("@typescript/vfs"), import("@effected/tsconfig-json")]),
				catch: (cause) => new TsEnvironmentError({ cause }),
			});
			return yield* Effect.try({
				try: () => {
					const typescript = tsModule.default;
					const projectRoot = options.projectRoot ?? process.cwd();

					// JSON-form options ("es2022") become the compiler's numeric
					// enums here — the only place the two representations meet.
					const compilerOptions = TsEnumCodec.encodeCompilerOptions(options.compilerOptions);

					// Locate lib.*.d.ts next to the compiler module that actually
					// loaded, not via require.resolve("typescript") (the vfs
					// default) — the two diverge when the classic compiler is
					// installed under an npm alias (e.g. alongside the native
					// TS 7 tsc, which ships no JS API or lib directory).
					// Structural access: the installed typescript's declarations may
					// be the native tsc's version-only stub, which types none of
					// the compiler API the consumer-provided module actually has.
					const executing = (
						typescript as { readonly sys?: { readonly getExecutingFilePath?: () => string } }
					).sys?.getExecutingFilePath?.();
					const libDirectory =
						executing === undefined
							? undefined
							: executing.slice(0, Math.max(executing.lastIndexOf("/"), executing.lastIndexOf("\\")));

					// Lib files resolve from the real node_modules; user files are
					// re-rooted under projectRoot (bare `node_modules/…` keys do not
					// resolve — probed against @typescript/vfs 1.6.x).
					const system = new Map<string, string>(
						tsVfs.createDefaultMapFromNodeModules(compilerOptions, typescript, libDirectory),
					);
					const rootFiles: Array<string> = [];
					for (const [path, content] of options.vfs) {
						const rooted = path.startsWith("/") ? path : `${projectRoot}/${path}`;
						system.set(rooted, content);
						if (isTypeDefinition(rooted)) rootFiles.push(rooted);
					}

					const sys = tsVfs.createFSBackedSystem(system, projectRoot, typescript, libDirectory);
					return tsVfs.createVirtualTypeScriptEnvironment(sys, rootFiles, typescript, compilerOptions);
				},
				catch: (cause) => new TsEnvironmentError({ cause }),
			});
		}).pipe(Effect.withSpan("TsEnvironment.make"));
	}
}
