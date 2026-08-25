/**
 * The decoded plugin options, as a service.
 *
 * @remarks
 * `ConfigService.layer` used to be a factory taking these as an argument, which
 * made it a layer-returning function — the shape the house rules warn about,
 * since layers memoize by reference and a second call mints a second layer.
 * It was only ever called once, but "only ever called once" is a property of
 * the current call sites, not of the design.
 *
 * A `Context.Service` rather than a `Context.Reference`, deliberately, and for
 * the same reason the Shiki themes are a layer argument: a Reference carries a
 * default, so a wiring mistake would silently resolve to empty options and the
 * build would document nothing while reporting success. There is no sensible
 * default for "which APIs is this site documenting", so forgetting to provide
 * it should be a loud "service not provided", which is what this gives.
 *
 * @packageDocumentation
 */

import { Context } from "effect";
import type { PluginOptions } from "../schemas/config.js";

export class PluginConfig extends Context.Service<PluginConfig, PluginOptions>()(
	"rspress-plugin-api-extractor/PluginConfig",
) {}
