/**
 * The registry's HTTP client applies pnpm's proxy and TLS configuration, and
 * falls back to a plain client — reporting once, on the first request — when
 * that configuration cannot be applied.
 *
 * @remarks
 * Drives the real layer against a scratch HOME and project directory and a
 * local HTTP server, so nothing reaches the network. Every input arrives
 * through the layer's options; `process.env` is never read or mutated.
 */

import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { registryHttpClientLayer } from "../../src/layers/registry-http-client.js";
import { PlatformLive } from "../../src/layers/xdg.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A scratch directory used as both HOME and the project directory. */
function scratch(npmrc?: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsdoctor-http-"));
	cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
	if (npmrc !== undefined) fs.writeFileSync(path.join(dir, ".npmrc"), npmrc);
	return dir;
}

/** A local server answering 200 and recording each request line's URL. */
async function server(): Promise<{ url: string; seen: string[] }> {
	const seen: string[] = [];
	const srv = http.createServer((req, res) => {
		seen.push(req.url ?? "");
		res.writeHead(200, { "content-type": "text/plain" }).end("ok");
	});
	await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
	cleanups.push(() => new Promise<void>((resolve) => srv.close(() => resolve())));
	return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, seen };
}

/** An env with HOME and XDG roots pointed at `dir`, so no real config is read. */
const isolatedEnv = (dir: string, extra: Record<string, string> = {}): Record<string, string> => ({
	HOME: dir,
	XDG_CONFIG_HOME: path.join(dir, "config"),
	...extra,
});

const getText = (url: string) =>
	Effect.gen(function* () {
		const client = yield* HttpClient.HttpClient;
		const response = yield* client.get(url);
		return yield* response.text;
	});

describe("registryHttpClientLayer", () => {
	it.live("routes requests through the proxy the environment configures", () =>
		Effect.gen(function* () {
			const dir = scratch();
			const proxy = yield* Effect.promise(server);
			const reasons: string[] = [];
			const layer = registryHttpClientLayer({
				cwd: dir,
				env: isolatedEnv(dir, { HTTP_PROXY: proxy.url }),
				platform: process.platform,
				onFallback: (reason) => Effect.sync(() => reasons.push(reason)),
			}).pipe(Layer.provide(PlatformLive));

			const body = yield* getText("http://types.example.invalid/pkg/index.d.ts").pipe(Effect.provide(layer));

			expect(body).toBe("ok");
			expect(proxy.seen).toEqual(["http://types.example.invalid/pkg/index.d.ts"]);
			expect(reasons).toEqual([]);
		}),
	);

	it.live("falls back to a direct client and reports once, on the first request, when a cafile is unreadable", () =>
		Effect.gen(function* () {
			const dir = scratch("cafile=/nonexistent/tsdoctor-test-ca.pem\n");
			const origin = yield* Effect.promise(server);
			const reasons: string[] = [];
			const layer = registryHttpClientLayer({
				cwd: dir,
				env: isolatedEnv(dir),
				platform: process.platform,
				onFallback: (reason) => Effect.sync(() => reasons.push(reason)),
			}).pipe(Layer.provide(PlatformLive));

			yield* Effect.scoped(
				Effect.gen(function* () {
					const context = yield* Layer.build(layer);
					// Built, but nothing requested yet: nothing reported.
					expect(reasons).toEqual([]);

					const first = yield* getText(`${origin.url}/a`).pipe(Effect.provideContext(context));
					const second = yield* getText(`${origin.url}/b`).pipe(Effect.provideContext(context));

					expect([first, second]).toEqual(["ok", "ok"]);
					expect(origin.seen).toEqual(["/a", "/b"]);
				}),
			);

			expect(reasons).toHaveLength(1);
			expect(reasons[0]).toMatch(/^proxy and TLS settings not applied/);
			expect(reasons[0]).toContain("cafile");
		}),
	);
});
