/**
 * The gate for swapping `tsconfig-parser.ts` onto `@effected/tsconfig-json`.
 *
 * @remarks
 * **A green suite does not gate this change; this file does.** The parser feeds
 * every API that declares a tsconfig, and the two failure modes it can
 * introduce are both silent: a compiler option that silently stops being
 * resolved degrades hovers with no diagnostic, and the wrong `lib` spelling
 * loads zero lib files while `handbookOptions.noErrorValidation` swallows the
 * evidence. Both have happened in this subsystem before.
 *
 * So this compares the OLD path (TypeScript's own `parseJsonConfigFileContent`)
 * against the NEW one (the kit loader) across every tsconfig the fixture sites
 * actually consume, and asserts on the key set rather than on values — a key
 * present via TypeScript but absent from the kit is a target-derived default
 * we depend on, and the thing most likely to vanish without a test noticing.
 */
import fs from "node:fs";
import path from "node:path";
import { TsconfigLoaderSync } from "@effected/tsconfig-json";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const fixtures = path.join(import.meta.dirname, "__fixtures__/tsconfigs");

/**
 * Committed tsconfigs covering the shapes the loader must agree on.
 *
 * @remarks
 * These are FIXTURES, not build output. An earlier version of this file read
 * the generated `dist/prod/npm/meta/tsconfig.json` from each module, which
 * exists only after a production build — so CI, which runs tests against the
 * dev build, failed on the deliberately-loud missing-fixture assertion below.
 * Reading a build artifact also makes the gate depend on build ordering rather
 * than on the thing under test.
 *
 * `flat/` mirrors the shape `@savvy-web/bundler` emits into a model folder
 * (the real input this parser sees in production), copied from one rather than
 * invented. `extends-chain/` covers relative `extends` merging. The two
 * tracked repo tsconfigs cover `extends` to a PACKAGE SPECIFIER — the
 * resolution the hand-rolled parser never actually implemented.
 */
const FIXTURE_TSCONFIGS = [
	path.join(fixtures, "flat/tsconfig.json"),
	path.join(fixtures, "extends-chain/tsconfig.json"),
	path.join(repoRoot, "platforms/rspress/tsconfig.json"),
	path.join(repoRoot, "modules/kitchensink/tsconfig.json"),
] as const;

/** The old path: TypeScript's own resolution, as `tsconfig-parser.ts` used it. */
function viaTypeScript(configPath: string): ts.CompilerOptions {
	const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
	const parsed = ts.parseJsonConfigFileContent(configFile.config ?? {}, ts.sys, path.dirname(configPath));
	return parsed.options;
}

/** The new path: the kit loader over plain node fs/path. */
function viaKit(configPath: string): Record<string, unknown> {
	return TsconfigLoaderSync.compilerOptions(configPath, {
		fileSystem: { exists: fs.existsSync, readFile: (p) => fs.readFileSync(p, "utf8") },
		path,
	}) as unknown as Record<string, unknown>;
}

/**
 * The options the plugin actually consumes. Anything outside this set may
 * legitimately differ between the two loaders — TypeScript synthesizes a great
 * many defaults (`configFilePath`, `pathsBasePath`, …) that are artifacts of
 * its own resolution rather than user configuration.
 */
const CONSUMED = [
	"target",
	"module",
	"moduleResolution",
	"lib",
	"strict",
	"skipLibCheck",
	"esModuleInterop",
	"allowSyntheticDefaultImports",
	"jsx",
	"types",
] as const;

describe("tsconfig loader differential", () => {
	for (const configPath of FIXTURE_TSCONFIGS) {
		const label = path.relative(repoRoot, configPath);

		it(`resolves the same consumed options for ${label}`, () => {
			// A missing fixture must fail loudly: silently skipping would make this
			// whole gate vacuous exactly when the models have not been built.
			expect(fs.existsSync(configPath), `fixture tsconfig missing: ${label}`).toBe(true);

			const oldOptions = viaTypeScript(configPath);
			const newOptions = viaKit(configPath);

			const oldKeys = CONSUMED.filter((k) => oldOptions[k] !== undefined);
			const newKeys = CONSUMED.filter((k) => newOptions[k] !== undefined);

			// The load-bearing assertion: a key TypeScript resolves but the kit does
			// not is a default we depend on and would lose silently.
			const lostKeys = oldKeys.filter((k) => !newKeys.includes(k));
			expect(lostKeys, `options resolved by TypeScript but not the kit: ${lostKeys.join(", ")}`).toEqual([]);
		});
	}

	it("documents that the two loaders use DIFFERENT spellings for the same value", () => {
		// Not a defect — it is the whole reason Task 1.2 had to land first.
		// TypeScript resolves to programmatic enums and lib FILE names; the kit
		// resolves to the tsconfig spelling. `toProgrammaticCompilerOptions`
		// normalizes at one seam, and both spellings must keep flowing into it.
		const configPath = path.join(fixtures, "flat/tsconfig.json");
		const oldOptions = viaTypeScript(configPath);
		const newOptions = viaKit(configPath);

		expect(typeof oldOptions.target).toBe("number");
		expect(typeof newOptions.target).toBe("string");
		expect(oldOptions.lib?.[0]).toMatch(/^lib\..*\.d\.ts$/);
		expect(String((newOptions.lib as string[])[0])).not.toMatch(/^lib\./);
	});
});
