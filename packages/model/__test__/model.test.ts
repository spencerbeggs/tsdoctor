import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { ApiModel } from "@microsoft/api-extractor-model";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Model } from "../src/index.js";

describe("Model.load", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("fails with ModelNotFoundError when the model file is missing", async () => {
		const result = await Effect.runPromise(Effect.result(Model.load("/no/such/model.api.json")));
		expect(result._tag).toBe("Failure");
		if (result._tag === "Failure") {
			expect(result.failure._tag).toBe("ModelNotFoundError");
			expect(result.failure.message).toMatch(/not found/);
		}
	});

	it("resolves the path, passes the existence guard, and delegates to ApiModel.loadPackage", async () => {
		const tmpPath = join(tmpdir(), "model-loader-happy.api.json");
		writeFileSync(tmpPath, "{}");
		try {
			const sentinel = { name: "sentinel-package" };
			const spy = vi.spyOn(ApiModel.prototype, "loadPackage").mockReturnValue(sentinel as never);

			await expect(Effect.runPromise(Model.load(tmpPath))).resolves.toBe(sentinel);
			expect(spy).toHaveBeenCalledWith(resolve(tmpPath));
		} finally {
			rmSync(tmpPath, { force: true });
		}
	});

	it("fails with ModelParseError when the deserializer throws", async () => {
		const tmpPath = join(tmpdir(), "model-loader-broken.api.json");
		writeFileSync(tmpPath, "not json at all");
		try {
			const result = await Effect.runPromise(Effect.result(Model.load(tmpPath)));
			expect(result._tag).toBe("Failure");
			if (result._tag === "Failure") {
				expect(result.failure._tag).toBe("ModelParseError");
				expect(result.failure.message).toContain(resolve(tmpPath));
			}
		} finally {
			rmSync(tmpPath, { force: true });
		}
	});
});

describe("Model.firstPackage", () => {
	it("fails with EmptyModelError for a model without packages", async () => {
		const result = await Effect.runPromise(Effect.result(Model.firstPackage(new ApiModel())));
		expect(result._tag).toBe("Failure");
		if (result._tag === "Failure") {
			expect(result.failure._tag).toBe("EmptyModelError");
			expect(result.failure.message).toMatch(/no packages/);
		}
	});

	it("returns the first package when present", async () => {
		const sentinel = { name: "sentinel" };
		const model = { packages: [sentinel] } as unknown as ApiModel;
		await expect(Effect.runPromise(Model.firstPackage(model))).resolves.toBe(sentinel);
	});
});
