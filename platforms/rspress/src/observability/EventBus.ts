import { Context, Effect, Layer, Option } from "effect";
import { BuildId } from "../BuildEnv.js";
import type { EventLevel, PluginEvent } from "./events.js";
import { LEVEL_RANK, levelOf } from "./events.js";
import type { EventSink } from "./sinks/types.js";

export interface EventBusShape {
	readonly emit: (event: PluginEvent) => Effect.Effect<void>;
	readonly wantsLevel: (level: EventLevel) => Effect.Effect<boolean>;
}

export class EventBus extends Context.Service<EventBus, EventBusShape>()("rspress-plugin-api-extractor/EventBus") {}

function makeShape(sinks: readonly EventSink[]): EventBusShape {
	// Only sinks that serialize payloads drive the wantsLevel hint. Scalar-only
	// sinks (e.g. metrics) omit capturesPayload so callers are not forced to
	// build expensive string/JSON payloads just to update a counter.
	const maxAdmitted = sinks
		.filter((s) => s.capturesPayload === true)
		.reduce((max, s) => Math.max(max, LEVEL_RANK[s.minLevel]), -1);
	return {
		emit: (event) =>
			Effect.sync(() => {
				const rank = LEVEL_RANK[levelOf(event)];
				for (const sink of sinks) {
					if (rank <= LEVEL_RANK[sink.minLevel]) sink.handle(event);
				}
			}),
		wantsLevel: (level) => Effect.succeed(LEVEL_RANK[level] <= maxAdmitted),
	};
}

export function makeEventBusLayer(sinks: readonly EventSink[]): Layer.Layer<EventBus> {
	return Layer.succeed(EventBus, makeShape(sinks));
}

/**
 * Emit when a bus is in context; silently no-op otherwise.
 *
 * @remarks
 * Fills `ctx.buildId` from the {@link BuildId} Reference when the caller left
 * it empty, which is why no emit site passes one. Before this, 24 sites wrote
 * `ctx: { buildId: "" }` — 22 in `ConfigServiceLive`, where the real value sat
 * three scopes up and was simply not reached, and every site in
 * `TypeRegistryServiceLive`, where the layer is module-level and there is no
 * build to name. The second group is why a Reference is the fix and a
 * find-and-replace is not: a Reference reaches code that no parameter can.
 *
 * A caller that sets a non-empty `buildId` keeps it, so a test can still emit
 * with an explicit id.
 */
export function emit(event: PluginEvent): Effect.Effect<void> {
	return Effect.gen(function* () {
		const maybe = yield* Effect.serviceOption(EventBus);
		if (Option.isNone(maybe)) return;
		const filled =
			(event.ctx.buildId ?? "") === ""
				? ({ ...event, ctx: { ...event.ctx, buildId: yield* BuildId } } as PluginEvent)
				: event;
		yield* maybe.value.emit(filled);
	});
}

/**
 * Returns true when a bus is in context and has at least one sink admitted at
 * `level`; false otherwise. R = never, safe to use anywhere emit is used.
 */
export function wantsLevel(level: EventLevel): Effect.Effect<boolean> {
	return Effect.serviceOption(EventBus).pipe(
		Effect.flatMap((maybe) => (Option.isSome(maybe) ? maybe.value.wantsLevel(level) : Effect.succeed(false))),
	);
}

/** Bind a runtime so non-Effect (sync island) callbacks can emit. */
export function makeRuntimeEmitter(runtime: {
	runSync: (effect: Effect.Effect<void>) => void;
}): (event: PluginEvent) => void {
	return (event) => runtime.runSync(emit(event));
}
