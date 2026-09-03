/**
 * Bug: prose cross-links leaked across APIs in one build.
 *
 * The page generators linked prose through a module-level holder
 * (`markdown/prose-linker.ts`, `setProseLinker`) that `generateApiDocs` set
 * once per API — while APIs generate concurrently. Whichever API installed
 * the holder last owned it for every page generated afterwards. On the
 * versioned fixture site, v1's `class/logger.mdx` linked `[Logger]` to
 * `/api/class/logger` and `[LogLevel]` to `/api/enum/loglevel` — v2's routes,
 * since v2 is the default version mounted at `/api` — instead of
 * `/v1/api/...`; on the multi site, effect-kit's `namespace/runmanifest.mdx`
 * left `Encoded` unlinked because kitchensink's route map had won.
 *
 * The fix carries the linker in the pipeline context, so this pins it by
 * generating the SAME item under two API contexts concurrently and asserting
 * each page links against its own base route. A shared holder cannot pass:
 * one of the two would carry the other's `/api` or `/v1/api` prefix.
 */

import path from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { CrossLinker } from "@tsdoctor/model";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import type { GenerateSinglePageContext, WorkItem } from "../../src/build-stages.js";
import { generateSinglePage, prepareWorkItems } from "../../src/build-stages.js";
import { loadApiModel } from "../../src/model-loader.js";
import { DEFAULT_CATEGORIES } from "../../src/schemas/config.js";
import { TestOgServiceLayer } from "../utils/layers.js";

const fixture = path.join(import.meta.dirname, "..", "__fixtures__", "kitchensink", "kitchensink.api.json");

interface ApiUnderTest {
	readonly baseRoute: string;
	readonly apiScope: string;
	readonly workItem: WorkItem;
	readonly ctx: GenerateSinglePageContext;
}

/** The same model prepared under its own base route, with its own linker. */
async function prepareApi(baseRoute: string, apiScope: string): Promise<ApiUnderTest> {
	const { apiPackage } = await Effect.runPromise(loadApiModel(fixture));
	const { workItems, crossLinkData } = prepareWorkItems({
		apiPackage,
		categories: DEFAULT_CATEGORIES,
		baseRoute,
	});
	// PipelineStatus's member descriptions mention `Pipeline`, which the linker resolves.
	const workItem = workItems.find((w) => w.item.displayName === "PipelineStatus");
	if (!workItem) throw new Error("kitchensink has no PipelineStatus enum");
	return {
		baseRoute,
		apiScope,
		workItem,
		ctx: {
			buildId: "prose-linker-race",
			existingSnapshots: new Map(),
			baseRoute,
			packageName: "@modules/kitchensink",
			apiScope,
			linker: CrossLinker.fromRoutes(crossLinkData.routes),
			buildTime: new Date().toISOString(),
			resolvedOutputDir: "/tmp/nonexistent-dir",
		},
	};
}

describe("Bug: prose cross-links leaked across concurrently generated APIs", () => {
	it("links each API's pages against its own route map when two APIs generate concurrently", async () => {
		// The versioned shape: the default version at /api, an older one at /v1/api.
		const [v2, v1] = await Promise.all([prepareApi("/api", "api"), prepareApi("/v1/api", "v1")]);

		const [pageV2, pageV1] = await Effect.runPromise(
			Effect.all([generateSinglePage(v2.workItem, v2.ctx), generateSinglePage(v1.workItem, v1.ctx)], {
				concurrency: 2,
			}).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, TestOgServiceLayer))),
		);
		if (!pageV2 || !pageV1) throw new Error("expected both pages");

		// The exact hrefs that used to leak: v1 carried v2's `/api/...` links.
		expect(pageV1.bodyContent).toContain("[Pipeline](/v1/api/class/pipeline)");
		expect(pageV1.bodyContent).not.toContain("](/api/class/pipeline)");
		expect(pageV2.bodyContent).toContain("[Pipeline](/api/class/pipeline)");
		expect(pageV2.bodyContent).not.toContain("](/v1/api/");
	});

	it("does not link one API's prose against another API's names", async () => {
		// The multi-site shape: two packages, each linked only against its own map.
		const kitchensink = await prepareApi("/kitchensink/api", "kitchensink");
		const other: GenerateSinglePageContext = {
			...kitchensink.ctx,
			baseRoute: "/other/api",
			apiScope: "other",
			// A route map that knows nothing of `Pipeline`.
			linker: CrossLinker.fromRoutes(new Map([["Unrelated", "/other/api/class/unrelated"]])),
		};
		const [linked, unlinked] = await Effect.runPromise(
			Effect.all(
				[generateSinglePage(kitchensink.workItem, kitchensink.ctx), generateSinglePage(kitchensink.workItem, other)],
				{
					concurrency: 2,
				},
			).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, TestOgServiceLayer))),
		);
		if (!linked || !unlinked) throw new Error("expected both pages");
		expect(linked.bodyContent).toContain("[Pipeline](/kitchensink/api/class/pipeline)");
		expect(unlinked.bodyContent).not.toContain("[Pipeline](");
	});
});
