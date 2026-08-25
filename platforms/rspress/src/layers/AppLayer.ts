/**
 * The build's layer stack, tiered.
 *
 * @remarks
 * `plugin.ts` used to merge eleven layers side by side in one `Layer.mergeAll`
 * — `NodeFileSystem.layer` (platform) next to `TypeRegistryService.layer`
 * (domain) next to `makeSummaryLoggerLayer` (observability) — with one of them
 * carrying a local `Layer.provide` because a flat merge could not feed it its
 * dependencies. Reading that told you what the build contains but not what
 * depends on what.
 *
 * The tiers below are ordered by what they may reach: platform knows nothing
 * about this plugin, core services know the platform, and build-scoped services
 * know both.
 *
 * @packageDocumentation
 */

import { NodeFileSystem } from "@effect/platform-node";
import type { StoreError, StoreMigrationError } from "@effected/store";
import { SnapshotService } from "@tsdoctor/snapshot";
import type { FileSystem } from "effect";
import { Layer } from "effect";
import { BuildId, PageConcurrency, SuppressExampleErrors, Thresholds } from "../BuildEnv.js";
import { collectShikiThemes } from "../markdown/shiki-utils.js";
import type { EventBus } from "../observability/EventBus.js";
import type { PluginOptions } from "../schemas/config.js";
import type { ResolvedObservability } from "../schemas/observability.js";
import { ConfigService } from "../services/ConfigService.js";
import { HighlighterService } from "../services/HighlighterService.js";
import { OgService } from "../services/OgService.js";
import { PluginConfig } from "../services/PluginConfig.js";
import { TwoslashCacheService } from "../services/TwoslashCacheService.js";
import { TwoslashEnvironments } from "../services/TwoslashEnvironments.js";
import { TypeRegistryService } from "../services/TypeRegistryService.js";
import type { MetricStore } from "./build-metrics.js";
import { makeSummaryLoggerLayer } from "./observability.js";
import { PlatformLive } from "./xdg.js";

/**
 * Everything the stack needs that is decided per build rather than per process.
 *
 * @remarks
 * `eventBus` and `metrics` come from one `buildEventBus(obs)` call and are
 * passed in rather than built here, because the metrics sink already holds
 * `metrics.context`. Building a second store here would give the sink and
 * `logBuildSummary` different registries — an all-zeros build summary with no
 * error anywhere.
 */
export interface AppLayerInput {
	readonly options: PluginOptions;
	readonly obs: ResolvedObservability;
	readonly buildId: string;
	/** Absolute path to the snapshot SQLite database. Its directory must exist. */
	readonly dbPath: string;
	/** Worker count for the page-generation stream. */
	readonly pageConcurrency: number;
	readonly eventBus: Layer.Layer<EventBus>;
	readonly metrics: MetricStore;
}

/**
 * The two layer stacks a build runs on.
 *
 * @remarks
 * Returned together, deliberately. They MUST share `metrics.layer` and the
 * `BuildEnv` references by reference, and both invariants are silent when
 * broken: a split metric registry reports every count as zero, and a split
 * `BuildId` mislabels every event a sync island emits. Handing both stacks back
 * from one call is what makes constructing them from different inputs
 * impossible, rather than merely discouraged.
 */
export interface AppLayers {
	/**
	 * The main stack.
	 *
	 * @remarks
	 * **Asynchronous to build** — it opens two SQLite files — which is the whole
	 * reason {@link AppLayers.emitter} exists separately.
	 *
	 * The error channel is not `never`: `SnapshotService.layer` can fail to open
	 * or migrate its database, and that failure surfaces when the
	 * `ManagedRuntime` first builds rather than at any call site. Stating it
	 * here rather than erasing it is deliberate — a corrupt snapshot DB should
	 * stop the build loudly, unlike the two cache layers, which degrade.
	 */
	readonly app: Layer.Layer<
		| ConfigService
		| PluginConfig
		| HighlighterService
		| TwoslashEnvironments
		| TwoslashCacheService
		| TypeRegistryService
		| OgService
		| SnapshotService
		| EventBus
		| FileSystem.FileSystem,
		StoreError | StoreMigrationError
	>;
	/**
	 * The sync-island stack, for the emitters `installSyncEmitter` binds.
	 *
	 * **Every layer in it must stay `Layer.succeed`.** `makeRuntimeEmitter`
	 * calls `runtime.runSync`, which builds the runtime's layer before running
	 * anything, so one asynchronous layer here means the first sync emit from a
	 * remark plugin or a Shiki callback dies with `AsyncFiberError` — during
	 * RSPress's render pass, where no unit test looks. That is why this is not
	 * simply a subset of {@link AppLayers.app}.
	 */
	readonly emitter: Layer.Layer<EventBus>;
}

/**
 * Build both stacks for one build.
 *
 * @remarks
 * **A layer factory: call it once and bind the result to a `const`.** Layers
 * memoize by reference, so a second call mints a second stack — a second Shiki
 * highlighter, a second snapshot database, a second metric registry.
 */
export function makeAppLayers(input: AppLayerInput): AppLayers {
	/**
	 * Per-build configuration, provided to BOTH stacks. Sharing these values is
	 * what lets a sync island and an Effect program agree on the build id and
	 * the slow-block threshold without either being handed them.
	 */
	const BuildEnvLayer = Layer.mergeAll(
		Layer.succeed(BuildId, input.buildId),
		Layer.succeed(Thresholds, input.obs.thresholds),
		Layer.succeed(PageConcurrency, input.pageConcurrency),
		Layer.succeed(SuppressExampleErrors, input.options.errors?.example !== "show"),
	);

	/**
	 * Sinks, metrics and the logger gate. Synchronously buildable, which is what
	 * lets the emitter stack below reuse it wholesale.
	 */
	const ObservabilityLayer = Layer.mergeAll(
		input.eventBus,
		// Scope metric state to this build. `Metric.MetricRegistry` is a
		// `Context.Reference` whose default Map is shared by every context that
		// does not override it, so without this every build in a process
		// accumulates into one registry. This layer MUST carry the same registry
		// the metrics sink writes through, or reads and writes silently diverge —
		// which is why it arrives as an input rather than being built here.
		input.metrics.layer,
		makeSummaryLoggerLayer(input.obs.logLevel),
	);

	/** Services that own a resource and need only the platform to build. */
	const CoreLayer = Layer.mergeAll(
		TypeRegistryService.layer,
		TwoslashCacheService.layer,
		SnapshotService.layer(input.dbPath),
		Layer.provide(OgService.layer, PlatformLive),
	);

	/** Bound to a `const`: this is a factory, and a second call acquires a second highlighter. */
	const HighlighterLive = HighlighterService.layer(
		collectShikiThemes(input.options.api ? [input.options.api] : (input.options.apis ?? [])),
	);

	/** Services scoped to this build's configuration. */
	const BuildLayer = Layer.mergeAll(
		Layer.succeed(PluginConfig, input.options),
		HighlighterLive,
		TwoslashEnvironments.layer,
		BuildEnvLayer,
	);

	const app = Layer.provideMerge(
		ConfigService.layer,
		Layer.mergeAll(BuildLayer, CoreLayer, ObservabilityLayer, NodeFileSystem.layer),
	);

	const emitter = Layer.mergeAll(ObservabilityLayer, BuildEnvLayer);

	return { app, emitter };
}
