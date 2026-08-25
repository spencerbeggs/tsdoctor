/**
 * Accumulating one API's resolution result into the build-wide totals.
 *
 * @remarks
 * `ConfigService.layer` resolves APIs down three paths — versioned, single
 * non-versioned, and multi-API — and each one ended with a near-identical
 * ~35-line block that merged the same three accumulators and then emitted the
 * same two events per VFS entry. Three copies of one algorithm is three places
 * for it to drift, and the third copy had ALREADY drifted: it emits its events
 * inside the per-API effect and merges afterwards, rather than doing both in
 * one pass.
 *
 * Splitting the block in two is what makes all three paths expressible. The
 * merge is pure and the emission is effectful, and the multi-API path needs
 * them at different moments; a single combined helper would have fitted two
 * paths and forced the third to keep its own copy.
 *
 * @packageDocumentation
 */

import { Effect } from "effect";
import { emit } from "../observability/EventBus.js";
import type { ImportRef } from "../observability/events.js";
import { PluginEvent } from "../observability/events.js";
import type { ResolvedApiConfig } from "../services/ConfigService.js";
import type { ExternalPackageSpec } from "../services/TypeRegistryService.js";

/** One VFS declaration entry, as the events below report it. */
export interface VfsEntryPayload {
	file: string;
	entryPoint: string;
	declCount: number;
	contentHash: string;
	content: string;
	/** True only when import statements were actually prepended to this entry. */
	hasImports: boolean;
	importRefs: readonly ImportRef[];
}

/**
 * One API's (or one version's) contribution to the build.
 *
 * @remarks
 * `config` is nullable because the versioned path can resolve a version that
 * produces VFS entries but no page-generating configuration.
 */
export interface ApiResolutionResult {
	readonly vfs: ReadonlyMap<string, string>;
	readonly vfsPayloads: ReadonlyArray<VfsEntryPayload>;
	readonly externalPackages: ReadonlyArray<ExternalPackageSpec>;
	readonly config: ResolvedApiConfig | null;
}

/** The build-wide totals every resolution path accumulates into. */
export interface ApiResultAccumulator {
	readonly apiConfigs: ResolvedApiConfig[];
	readonly combinedVfs: Map<string, string>;
	readonly allExternalPackages: ExternalPackageSpec[];
}

/**
 * Merge one result into the build-wide accumulators.
 *
 * @remarks
 * Mutates `acc` rather than returning a new one. The accumulators are three
 * `const` collections in a long generator that appends to them from several
 * branches, and threading a replacement through every branch would be a larger
 * change than this task is buying.
 *
 * **The VFS is a single flat namespace shared by every documented API.** A
 * later entry silently overwrites an earlier one at the same path, which is
 * load-bearing rather than accidental: cross-package type references resolve
 * only because every package's declarations live in one environment (see
 * `type-loading-vfs.md`).
 */
export function mergeApiResult(acc: ApiResultAccumulator, result: ApiResolutionResult): void {
	for (const [filepath, content] of result.vfs.entries()) {
		acc.combinedVfs.set(filepath, content);
	}
	if (result.externalPackages.length > 0) {
		acc.allExternalPackages.push(...result.externalPackages);
	}
	if (result.config) {
		acc.apiConfigs.push(result.config);
	}
}

/**
 * Emit the per-entry VFS events for one API's payloads.
 *
 * @remarks
 * `ImportsPrepended` fires only when imports were actually prepended, so an
 * entry that needed none produces one event rather than two.
 *
 * `wantTrace` gates the two heavy fields — the full declaration text and the
 * resolved import refs. Both are only ever read by the JSONL trace sink, and
 * carrying them unconditionally would put every generated declaration file
 * through the event bus on every build.
 */
export function emitVfsPayloadEvents(
	packageName: string,
	payloads: ReadonlyArray<VfsEntryPayload>,
	wantTrace: boolean,
): Effect.Effect<void> {
	return Effect.gen(function* () {
		for (const payload of payloads) {
			const ctx = {
				packageName,
				...(payload.entryPoint ? { entryPoint: payload.entryPoint } : {}),
			};
			yield* emit(
				PluginEvent.VfsGenerated({
					ctx,
					level: "debug",
					file: payload.file,
					declCount: payload.declCount,
					contentHash: payload.contentHash,
					...(wantTrace && payload.content ? { content: payload.content } : {}),
				}),
			);
			if (payload.hasImports) {
				yield* emit(
					PluginEvent.ImportsPrepended({
						ctx,
						level: "debug",
						file: payload.file,
						imports: wantTrace ? payload.importRefs : [],
					}),
				);
			}
		}
	});
}
