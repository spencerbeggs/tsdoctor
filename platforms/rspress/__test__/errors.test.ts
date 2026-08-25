import { describe, expect, it } from "vitest";
import { ConfigValidationError, TypeRegistryError } from "../src/errors.js";

/**
 * @remarks
 * Four sibling error types — `ApiModelLoadError`, `PageGenerationError`,
 * `TwoslashProcessingError`, `PrettierFormatError` — were deleted along with
 * their cases here. Each was constructed nowhere in `src/` and asserted only in
 * this file, so these tests were the only thing keeping them alive. What those
 * subsystems actually report is a `PluginEvent` through the EventBus, not a
 * typed error: Twoslash and Prettier failures reach `issues.json` as events
 * (see `error-observability.md`), and model-load failures became
 * `Model.load`'s own typed errors in the phase-2 redesign.
 */
describe("TaggedError types", () => {
	it("ConfigValidationError has correct tag, fields, and message", () => {
		const err = new ConfigValidationError({
			field: "api.model",
			reason: "Required when multiVersion is not active",
		});
		expect(err._tag).toBe("ConfigValidationError");
		expect(err.field).toBe("api.model");
		expect(err.reason).toBe("Required when multiVersion is not active");
		expect(err.message).toBe("Config validation failed for 'api.model': Required when multiVersion is not active");
	});

	it("ConfigValidationError carries the original failure as cause", () => {
		const cause = new Error("ENOENT: no such file or directory");
		const err = new ConfigValidationError({ field: "tsconfig", reason: cause.message, cause });
		expect(err.cause).toBe(cause);
	});

	it("TypeRegistryError has correct tag, fields, and message", () => {
		const err = new TypeRegistryError({
			packageName: "zod",
			version: "^3.22.4",
			reason: "Network timeout",
		});
		expect(err._tag).toBe("TypeRegistryError");
		expect(err.packageName).toBe("zod");
		expect(err.version).toBe("^3.22.4");
		expect(err.reason).toBe("Network timeout");
		expect(err.message).toBe("Type registry error for 'zod@^3.22.4': Network timeout");
	});
});
