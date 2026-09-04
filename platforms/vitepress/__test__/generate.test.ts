/**
 * `generate` resolving an API's bundle — display identity and Open Graph
 * images from a `tsdoctor.json` sidecar beside the model — end to end
 * against a real filesystem.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NodeFileSystem } from "@effect/platform-node";
import type { TypeRegistryShape } from "@tsdoctor/registry";
import { TypeRegistry } from "@tsdoctor/registry";
import { Effect, Layer, Path } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import type { GenerateInput } from "../src/Generate.js";
import { generate } from "../src/Generate.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(here, "fixtures", "bundle-manifest");

const PlatformTest = Layer.mergeAll(NodeFileSystem.layer, Path.layer);
// No package.json and no `externalPackages` option means `loadExternalTypes`
// never has a candidate, so `TypeRegistry` is never actually called — this
// double only needs to satisfy the type.
const TypeRegistryTest = Layer.succeed(TypeRegistry, {} as TypeRegistryShape);
const TestLayer = Layer.mergeAll(PlatformTest, TypeRegistryTest);

const tmpDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function runGenerate(overrides: Partial<GenerateInput> = {}) {
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vitepress-generate-"));
	tmpDirs.push(tmpDir);
	const input: GenerateInput = {
		dir: fixtureDir,
		cwd: tmpDir,
		docsDir: "docs",
		baseRoute: "/api",
		siteOrigin: "https://example.com",
		...overrides,
	};
	await Effect.runPromise(generate(input).pipe(Effect.provide(TestLayer)));
	return tmpDir;
}

async function readClassPage(tmpDir: string): Promise<string> {
	return fs.readFile(path.join(tmpDir, "docs", "api", "class", "animal.md"), "utf8");
}

describe("generate — bundle manifest", () => {
	it("publishes the manifest's OG image and emits og:image, og:site_name and og:title", async () => {
		const tmpDir = await runGenerate();
		const body = await readClassPage(tmpDir);

		expect(body).toContain("og:image");
		expect(body).toContain("https://example.com/tsdoctor/example/k.png");
		expect(body).toContain("og:site_name");
		expect(body).toContain("tsdoctor");
		expect(body).toContain("og:title");
		expect(body).toContain("Animal");

		const published = await fs.readFile(path.join(tmpDir, "docs", "public", "tsdoctor", "example", "k.png"));
		expect(published.byteLength).toBeGreaterThan(0);
	});

	it("an absolute-URL ogImage option wins over the manifest and copies nothing", async () => {
		const tmpDir = await runGenerate({ ogImage: "https://x.test/og.png" });
		const body = await readClassPage(tmpDir);

		expect(body).toContain("https://x.test/og.png");
		expect(body).not.toContain("tsdoctor/example/k.png");
		await expect(fs.stat(path.join(tmpDir, "docs", "public", "tsdoctor", "example"))).rejects.toThrow();
	});

	it("a bundle-relative ogImage option publishes the referenced file from the bundle directory", async () => {
		const tmpDir = await runGenerate({ ogImage: "og/k.png" });
		const body = await readClassPage(tmpDir);

		expect(body).toContain("https://example.com/tsdoctor/example/k.png");
		const published = await fs.readFile(path.join(tmpDir, "docs", "public", "tsdoctor", "example", "k.png"));
		expect(published.byteLength).toBeGreaterThan(0);
	});
});
