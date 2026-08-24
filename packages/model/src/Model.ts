/**
 * Effect-typed loading of Microsoft API Extractor `.api.json` models.
 *
 * @remarks
 * `load` deliberately requires no `FileSystem` service: the underlying
 * `@microsoft/api-extractor-model` deserializer only exposes a file-path
 * entry point (`ApiModel#loadPackage` / `ApiPackage.loadFromJsonFile`) and
 * performs its own synchronous fs read — injecting a `FileSystem` the loader
 * would silently bypass would be dishonest dependency injection. Failures are
 * typed on the error channel instead.
 *
 * @packageDocumentation
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { ApiPackage } from "@microsoft/api-extractor-model";
import { ApiModel as MsApiModel } from "@microsoft/api-extractor-model";
import { Effect, Schema } from "effect";

/**
 * The `.api.json` file does not exist at the resolved path.
 *
 * @public
 */
export class ModelNotFoundError extends Schema.TaggedError<ModelNotFoundError>()("ModelNotFoundError", {
	modelPath: Schema.String,
}) {
	override get message(): string {
		return `API model file not found: ${this.modelPath}`;
	}
}

/**
 * The `.api.json` file exists but could not be deserialized (malformed JSON,
 * unsupported schema version, …). `reason` carries the deserializer's message.
 *
 * @public
 */
export class ModelParseError extends Schema.TaggedError<ModelParseError>()("ModelParseError", {
	modelPath: Schema.String,
	reason: Schema.String,
}) {
	override get message(): string {
		return `Failed to load API model at ${this.modelPath}: ${this.reason}`;
	}
}

/**
 * An in-memory `ApiModel` carries no packages (or is otherwise unusable).
 *
 * @public
 */
export class EmptyModelError extends Schema.TaggedError<EmptyModelError>()("EmptyModelError", {
	reason: Schema.String,
}) {
	override get message(): string {
		return this.reason;
	}
}

/**
 * Load a `.api.json` model file and return its single `ApiPackage`.
 *
 * @public
 */
export const load = (modelPath: string): Effect.Effect<ApiPackage, ModelNotFoundError | ModelParseError> =>
	Effect.suspend((): Effect.Effect<ApiPackage, ModelNotFoundError | ModelParseError> => {
		const resolved = resolve(modelPath);
		if (!existsSync(resolved)) {
			return Effect.fail(new ModelNotFoundError({ modelPath: resolved }));
		}
		return Effect.try({
			try: () => new MsApiModel().loadPackage(resolved),
			catch: (cause) =>
				new ModelParseError({
					modelPath: resolved,
					reason: cause instanceof Error ? cause.message : String(cause),
				}),
		});
	});

/**
 * Extract the first (only) package from an already-constructed `ApiModel` —
 * the user-supplied-loader path, where the caller obtained the model itself.
 *
 * @public
 */
export const firstPackage = (model: MsApiModel): Effect.Effect<ApiPackage, EmptyModelError> => {
	const pkg = model.packages[0];
	return pkg !== undefined
		? Effect.succeed(pkg)
		: Effect.fail(new EmptyModelError({ reason: "API model contains no packages" }));
};
