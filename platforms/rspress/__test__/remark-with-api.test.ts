/**
 * `remarkWithApi`'s cross-linker lookup.
 *
 * @remarks
 * Structural pins, in the same category as the `plugin.ts` wiring pin in
 * `twoslash-access.test.ts`: the property is "this call site uses the page's
 * own scope", which is structural, and the behavioural version is
 * **unreachable in this repo**.
 *
 * That last part is the reason these exist rather than a behavioural test.
 * `inferApiScope` matches `docs/en/{api}/…`, and no fixture site has a
 * `with-api` fence under that shape:
 *
 * - `sites/basic` — fences under `docs/guides/…`
 * - `sites/multi` — one fence under `docs/blog/…`
 * - `sites/i18n` — has `docs/en/` but no fences
 *
 * So `apiScope` is `undefined` for every `with-api` fence in the repo, this
 * cross-linking branch never executes in any fixture build, and a mutation
 * that points the lookup at the wrong scope changes nothing observable. These
 * pins are currently the ONLY guard on this path.
 *
 * The path-shape mismatch itself is a live question, not something these pins
 * settle — see the plan's note on `inferApiScope` versus the deleted
 * `VfsRegistry.getByFilePath` regex.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../src/remark-with-api.ts", import.meta.url), "utf8");

describe("remarkWithApi cross-linker lookup", () => {
	// FORBIDS: reaching for any registered linker rather than the one for this
	// page's scope. In a multi-API build that links package A's code block
	// against package B's routes.
	it("looks the linker up by the page's own scope", () => {
		expect(source).toContain("VfsRegistry.get(apiScope)?.crossLinker");
	});

	// FORBIDS: reintroducing a shared, mutable linker passed through plugin
	// options — the shape Task 4.4 removed, where scope was a property of the
	// last call rather than of the instance.
	it("does not accept a cross-linker through plugin options", () => {
		expect(source).not.toContain("shikiCrossLinker");
	});
});
