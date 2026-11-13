/**
 * The HTTP client the type registry fetches from jsDelivr with.
 *
 * @remarks
 * A plain undici client ignores every proxy and TLS setting a developer
 * configured for their package manager: `HTTPS_PROXY`/`NO_PROXY`, an npmrc's
 * `proxy`/`https-proxy`/`noproxy`, `cafile`/`ca` and `strict-ssl`. Behind a
 * corporate proxy or a TLS-intercepting CA every external-types fetch then
 * fails, and because external types degrade rather than fail the build, the
 * only symptom is Twoslash pages that lost their dependencies' types.
 *
 * This layer reads the configuration pnpm 12 would connect with
 * (`PnpmNpmConfig.load`: the environment, `pnpm-workspace.yaml`, pnpm's global
 * `config.yaml` and the npmrc files) and hands it to `NpmHttpClient`, so the
 * registry connects the way `pnpm install` does from the same directory.
 *
 * A configuration that cannot be loaded, or a transport that cannot be built
 * from it (an unreadable `cafile`, an unparseable proxy URL), falls back to the
 * plain undici client and reports why. It never fails: external types are an
 * enhancement.
 *
 * The report is deferred to the first request rather than made while the layer
 * builds, so a build that never fetches (every package cached, or none
 * declared) prints nothing. The RSPress adapter keeps a twin of this file; keep
 * the two in step.
 *
 * @packageDocumentation
 */

import { NodeHttpClient } from "@effect/platform-node";
import { ErrorText } from "@effected/kit";
import { NpmHttpClient } from "@effected/npm/node";
import { PnpmNpmConfig } from "@effected/pnpm";
import type { FileSystem, Path } from "effect";
import { Cause, Effect, Layer } from "effect";
import * as HttpClient from "effect/http/HttpClient";

/** Where to read the configuration from, and how to report a fallback. */
export interface RegistryHttpClientOptions {
	/** The directory pnpm would run in; its workspace root holds the project `.npmrc`. */
	readonly cwd: string;
	/** The environment: pnpm's `PNPM_CONFIG_*` settings and the proxy variables. */
	readonly env: Readonly<Record<string, string | undefined>>;
	/** `process.platform`, for pnpm's global config directory. */
	readonly platform: string;
	/**
	 * Called once, on the first request and in the requesting fiber, with a
	 * readable reason, when the plain client is used instead.
	 */
	readonly onFallback: (reason: string) => Effect.Effect<void>;
}

/**
 * An `HttpClient` that honours pnpm's proxy and TLS configuration, falling back
 * to a plain undici client.
 *
 * @remarks
 * Each call builds a new layer and layers memoize by reference, so bind the
 * result to a `const` once.
 */
export const registryHttpClientLayer = (
	options: RegistryHttpClientOptions,
): Layer.Layer<HttpClient.HttpClient, never, FileSystem.FileSystem | Path.Path> =>
	Layer.unwrap(
		PnpmNpmConfig.load({ cwd: options.cwd, env: options.env, platform: options.platform }).pipe(
			Effect.map((config) => NpmHttpClient.layer(config, { env: options.env, packageManager: "pnpm" })),
		),
	).pipe(
		Layer.catchCause((cause) =>
			// Interruption is the caller shutting down, not a broken configuration:
			// re-raise it with its original interruptor rather than handing back a
			// working client (the RSPress adapter's TypeRegistryService.layer makes the same split).
			Cause.hasInterrupts(cause)
				? Layer.effectContext(Effect.failCause(Cause.interrupt([...Cause.interruptors(cause)][0])))
				: fallbackLayer(
						`proxy and TLS settings not applied, fetching external types directly: ${ErrorText.describe(Cause.squash(cause))}`,
						options.onFallback,
					),
		),
	);

/** The plain undici client, reporting `reason` once on its first request. */
const fallbackLayer = (
	reason: string,
	onFallback: RegistryHttpClientOptions["onFallback"],
): Layer.Layer<HttpClient.HttpClient> =>
	Layer.effect(
		HttpClient.HttpClient,
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient;
			const reportOnce = yield* Effect.cached(onFallback(reason));
			return HttpClient.tapRequest(client, () => reportOnce);
		}),
	).pipe(Layer.provide(NodeHttpClient.layerUndici));
