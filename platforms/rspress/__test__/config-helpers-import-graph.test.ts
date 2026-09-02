/**
 * `config-helpers.ts` must not drag the TypeScript compiler into config
 * evaluation.
 *
 * @remarks
 * `ApiExtractorPlugin.api.fromDir(...)` is called from `rspress.config.ts`,
 * which every RSPress command evaluates before doing anything else — including
 * `rspress dev`. A value import of `typescript` anywhere in that module's
 * transitive graph loads the whole compiler at config-evaluation time, for a
 * helper whose job is reading three files off disk.
 *
 * This became true when the tsconfig parser moved onto
 * `@effected/tsconfig-json`, which resolves `extends` chains itself. Before
 * that the parser used `ts.parseJsonConfigFileContent` and the compiler was
 * unavoidable here. The parser now lives in `@tsdoctor/vfs`, which guards the
 * same property on its own side.
 *
 * A `import type` is fine and deliberately allowed: it is erased at compile
 * time and adds nothing at runtime.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const srcDir = path.resolve(import.meta.dirname, "../src");

/** Walk the transitive relative-import graph from an entry module. */
function transitiveLocalImports(entry: string): Set<string> {
	const seen = new Set<string>();
	const queue = [entry];

	while (queue.length > 0) {
		const file = queue.pop();
		if (file == null || seen.has(file)) continue;
		seen.add(file);

		const text = fs.readFileSync(file, "utf8");
		for (const match of text.matchAll(/^\s*import\s+(?:type\s+)?[^"']*from\s+["'](\.[^"']+)["']/gm)) {
			const spec = match[1];
			if (spec == null) continue;
			// Sources import with the EMITTED extension (.js), so map back to .ts.
			const resolved = path.resolve(path.dirname(file), spec.replace(/\.js$/, ".ts"));
			if (fs.existsSync(resolved)) queue.push(resolved);
		}
	}
	return seen;
}

/** Value imports of `typescript` in a set of files, relative to `src/`. */
function typescriptValueImports(files: Iterable<string>): string[] {
	const offenders: string[] = [];
	for (const file of files) {
		const text = fs.readFileSync(file, "utf8");
		for (const match of text.matchAll(/^\s*import\s+(type\s+)?[^;]*?from\s+["']typescript["']/gm)) {
			if (match[1] === undefined) offenders.push(path.relative(srcDir, file));
		}
	}
	return offenders;
}

describe("typescript is not loaded at config-evaluation time", () => {
	it("config-helpers.ts reaches no value import of typescript", () => {
		const reachable = transitiveLocalImports(path.join(srcDir, "config-helpers.ts"));

		// Positive control: the walker must actually reach modules, or a clean
		// result would mean nothing. The parser's own half of this guarantee
		// moved with it to @tsdoctor/vfs (see that package's
		// compiler-options-seam test); this graph never included it anyway.
		expect(reachable.size).toBeGreaterThan(3);

		expect(typescriptValueImports(reachable)).toEqual([]);
	});
});
