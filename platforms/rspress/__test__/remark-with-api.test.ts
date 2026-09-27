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

// Structural pins for the SSG-MD branch, for the same reason as above: no
// fixture renders a `with-api` fence under SSG-MD, so nothing behavioural
// would fail. The rendered HAST carries Twoslash hover-popup text (types,
// JSDoc) in real text nodes, so any extraction from it garbles llms.txt.
describe("remarkWithApi SSG-MD code", () => {
	// FORBIDS: deriving llms.txt code from the rendered HAST, via an HTML
	// round-trip (which also leaked `&#x3C;`) or a text-node walk.
	it("does not recover SSG-MD code from the rendered HAST", () => {
		expect(source).not.toContain("hastToHtml");
		expect(source).not.toContain("hastText");
	});

	// FORBIDS: SSG-MD and the browser component showing different code.
	it("uses the same display code as the ApiExample component", () => {
		expect(source).toContain("const displayCode = stripTwoslashDirectives(code);");
		expect(source).toContain("const cleanCode = displayCode.trim();");
	});
});
