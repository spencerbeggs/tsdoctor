/**
 * Building the build's Twoslash type-checking environments.
 *
 * @remarks
 * The last phase of config resolution, and the only one that has to run after
 * every API has contributed to the VFS: the result cache is keyed on the type
 * environment, so it can only be opened once the VFS is final, and no code
 * block may be rendered before it is.
 *
 * @packageDocumentation
 */

import { resolveTypeScriptConfig } from "@tsdoctor/vfs";
import { Effect } from "effect";
import ts from "typescript";
import { ConfigValidationError } from "../errors.js";
import type { TypeResolutionCompilerOptions, TypeScriptConfig } from "../internal-types.js";
import { emit } from "../observability/EventBus.js";
import { PluginEvent } from "../observability/events.js";
import { TwoslashCacheService } from "../services/TwoslashCacheService.js";
import { TwoslashEnvironments } from "../services/TwoslashEnvironments.js";
import { twoslashEnvHash } from "../twoslash-cache.js";

/**
 * Resolve a TypeScript configuration, failing typed on a malformed one.
 *
 * @remarks
 * `resolveTypeScriptConfig` throws a `TsConfigParseError` for a missing file, a
 * syntax error or a semantically invalid config. Both call sites used to run it
 * inside `Effect.promise`, so all three became untyped defects: the build died
 * with an unhandled rejection naming a file the user could fix, and wrote no
 * `issues.json` entry for it.
 *
 * A malformed tsconfig is a user misconfiguration, so it is fatal and TYPED —
 * not degraded. Falling back to default compiler options would type-check every
 * example against a configuration the user did not ask for and silently render
 * wrong hovers, which is the failure shape this subsystem suffers from most
 * (see the `lib`-spelling defect in `type-loading-vfs.md`).
 */
export const resolveTsConfigTyped = (
	projectRoot: string,
	config: TypeScriptConfig | undefined,
): Effect.Effect<TypeResolutionCompilerOptions, ConfigValidationError> =>
	Effect.tryPromise({
		try: () => resolveTypeScriptConfig(projectRoot, config),
		catch: (cause) =>
			new ConfigValidationError({
				field: "tsconfig",
				reason: cause instanceof Error ? cause.message : String(cause),
				cause,
			}),
	});

/** Everything {@link registerTypeEnvironments} needs from config resolution. */
export interface TypeEnvironmentInput {
	/** Every documented API's declarations, in one flat namespace. */
	readonly combinedVfs: Map<string, string>;
	/** The build-wide options, used for the fallback environment. */
	readonly resolvedCompilerOptions: TypeResolutionCompilerOptions;
	/** Per-scope raw config; `undefined` means "use the build-wide options". */
	readonly scopeTsConfigs: ReadonlyMap<string, TypeScriptConfig | undefined>;
	readonly projectRoot: string;
}

/**
 * Open the Twoslash result cache and register one environment per distinct
 * compiler configuration.
 *
 * @remarks
 * **The build-wide options are registered FIRST, deliberately.** An unknown
 * scope falls back to the first environment registered, and a `with-api` fence
 * can appear on a page outside any documented package's route — checking it
 * under the build-wide configuration beats not checking it at all.
 *
 * Resolution is memoised twice over. This function memoises by RAW config, so
 * N APIs sharing a tsconfig read it from disk once; `registerEnvironment` then
 * dedupes by a fingerprint of the ENCODED options, so APIs that spell the same
 * configuration differently still share one TypeScript environment. The second
 * of those is load-bearing: when the two fingerprints drifted apart once, every
 * scope lookup missed, per-scope type-checking silently degraded to build-wide,
 * and a 994-test suite stayed green through it.
 */
export const registerTypeEnvironments = (
	input: TypeEnvironmentInput,
): Effect.Effect<void, ConfigValidationError, TwoslashCacheService | TwoslashEnvironments> =>
	Effect.gen(function* () {
		// The compiler version is part of the environment: lib.d.ts ships with
		// TypeScript and inference changes between releases, so a cached result is
		// only valid for the compiler that produced it.
		const twoslashEnv = twoslashEnvHash(input.combinedVfs, `typescript@${ts.version}`);
		const cacheSvc = yield* TwoslashCacheService;
		// The service holds the generation for the rest of the build: the render
		// pass that populates it runs after config() returns.
		const twoslashCache = yield* cacheSvc.open(twoslashEnv);
		yield* emit(
			PluginEvent.TwoslashCacheLoaded({
				ctx: {},
				level: "debug",
				envHash: twoslashEnv,
				entries: twoslashCache.entries().size,
				degraded: cacheSvc.degraded,
			}),
		);

		const twoslashStartMs = performance.now();
		const environments = yield* TwoslashEnvironments;

		environments.registerEnvironment({
			vfs: input.combinedVfs,
			compilerOptions: input.resolvedCompilerOptions,
			typesCache: twoslashCache,
		});

		const resolvedByRawConfig = new Map<string, TypeResolutionCompilerOptions>();
		for (const [apiScope, rawConfig] of input.scopeTsConfigs) {
			if (rawConfig === undefined) {
				environments.registerScope(apiScope, input.resolvedCompilerOptions);
				continue;
			}
			const rawKey = JSON.stringify([String(rawConfig.tsconfig ?? ""), rawConfig.compilerOptions ?? null]);
			let scopeOptions = resolvedByRawConfig.get(rawKey);
			if (scopeOptions === undefined) {
				scopeOptions = yield* resolveTsConfigTyped(input.projectRoot, rawConfig);
				resolvedByRawConfig.set(rawKey, scopeOptions);
			}
			environments.registerEnvironment({
				vfs: input.combinedVfs,
				compilerOptions: scopeOptions,
				typesCache: twoslashCache,
			});
			environments.registerScope(apiScope, scopeOptions);
		}

		yield* emit(
			PluginEvent.TwoslashInitialized({
				ctx: {},
				level: "debug",
				durationMs: Math.round(performance.now() - twoslashStartMs),
				vfsFileCount: input.combinedVfs.size,
			}),
		);
	});
