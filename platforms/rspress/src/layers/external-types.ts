/**
 * Merging external package declarations into the build's VFS.
 *
 * @remarks
 * The one phase of config resolution that **degrades rather than fails**.
 * External types are an enhancement: without them, code blocks render without
 * Twoslash enrichment, which is a worse page rather than a broken build. The
 * caller therefore never sees this fail — the failure is reported as a warning
 * and the VFS is left as it was.
 *
 * @packageDocumentation
 */

import { Effect } from "effect";
import { emit } from "../observability/EventBus.js";
import { PluginEvent } from "../observability/events.js";
import type { ResolvedApiConfig } from "../services/ConfigService.js";
import type { ExternalPackageSpec, TypeRegistryService } from "../services/TypeRegistryService.js";

/**
 * Fetch external package declarations and merge them into `combinedVfs`.
 *
 * @remarks
 * **First-party packages are excluded, and that exclusion is load-bearing.**
 * The packages being documented are already served from their api.json-derived
 * virtual VFS, which is authoritative. Their published version may not exist
 * yet (an optimistic next version), and if it did, fetching it would clobber
 * the generated declarations with the previous release's — silently
 * documenting the wrong API.
 *
 * Versions are resolved to exact published ones first: the CDN behind
 * `loadPackages` 404s on a range or an unpublished package, so a spec that
 * cannot be resolved is dropped with a debug event rather than failing the
 * batch it is in.
 *
 * Mutates `combinedVfs` in place, matching the other resolution phases.
 *
 * The registry arrives as an argument rather than being pulled from context.
 * `ConfigService.layer` resolves it ONCE at layer construction, and yielding
 * the tag here instead would move it into `resolve`'s per-call requirement
 * channel — a different resolution point, and a widened public signature, for
 * a dependency that does not vary per call.
 */
export const mergeExternalTypes = (
	typeRegistry: TypeRegistryService["Service"],
	combinedVfs: Map<string, string>,
	apiConfigs: ReadonlyArray<ResolvedApiConfig>,
	allExternalPackages: ReadonlyArray<ExternalPackageSpec>,
): Effect.Effect<void> =>
	Effect.gen(function* () {
		const documentedPackageNames = new Set(apiConfigs.map((config) => config.packageName));
		const externalPackagesToLoad = allExternalPackages.filter((pkg) => !documentedPackageNames.has(pkg.name));

		const typeLoadResult = yield* Effect.result(
			Effect.gen(function* () {
				if (externalPackagesToLoad.length === 0) return;

				const resolvedPackages = yield* typeRegistry.resolveVersions(externalPackagesToLoad);
				const droppedCount = externalPackagesToLoad.length - resolvedPackages.length;
				if (droppedCount > 0) {
					yield* emit(
						PluginEvent.ExternalPackageSkipped({
							ctx: {},
							level: "debug",
							reason: `${droppedCount} unresolvable package(s) (unpublished or workspace-only)`,
						}),
					);
				}

				if (resolvedPackages.length === 0) return;

				const result = yield* typeRegistry.loadPackages(resolvedPackages);
				for (const [filePath, content] of result.vfs.entries()) {
					combinedVfs.set(filePath, content);
				}

				yield* emit(
					PluginEvent.VfsMerged({
						ctx: {},
						level: "debug",
						totalFiles: result.vfs.size,
						packages: resolvedPackages.map((p) => p.name),
					}),
				);
			}),
		);

		// Degrade, do not fail — see the module remarks.
		if (typeLoadResult._tag === "Failure") {
			yield* emit(
				PluginEvent.ConfigCascadeWarning({
					ctx: {},
					level: "warn",
					field: "externalTypes",
					chosen: "empty VFS",
					ignored: [typeLoadResult.failure.message ?? String(typeLoadResult.failure)],
				}),
			);
		}
	});
