/**
 * The adapter is what consumers install, so it seals its kit closure: every
 * `effect`, `@effect/*` and `@effected/*` runtime dependency is pinned
 * through `catalog:effected:exact`, and every non-optional kit peer anywhere
 * in the closure is declared as one of those pinned dependencies. The
 * `@tsdoctor/*` libraries it ships pin their regular kit dependencies the
 * same way, since pnpm resolves those carets independently. A kit patch then
 * never reaches a consumer without a release of this package.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

interface Manifest {
	readonly name: string;
	readonly dependencies?: Record<string, string>;
	readonly peerDependencies?: Record<string, string>;
	readonly peerDependenciesMeta?: Record<string, { readonly optional?: boolean }>;
}

const packageRoot = path.resolve(import.meta.dirname, "..");
const readManifest = (dir: string): Manifest =>
	JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as Manifest;
const manifest = readManifest(packageRoot);

const isKit = (name: string): boolean => /^(effect$|@effect\/|@effected\/)/.test(name);
const isClosure = (name: string): boolean => isKit(name) || name.startsWith("@tsdoctor/");

const resolveDir = (from: string, name: string): string | undefined => {
	for (let dir = from; ; dir = path.dirname(dir)) {
		const candidate = path.join(dir, "node_modules", name);
		if (fs.existsSync(path.join(candidate, "package.json"))) return fs.realpathSync(candidate);
		if (path.dirname(dir) === dir) return undefined;
	}
};

describe("kit closure pins", () => {
	const kitDependencies = Object.entries(manifest.dependencies ?? {}).filter(([name]) => isKit(name));

	it("declares kit runtime dependencies", () => {
		expect(kitDependencies.length).toBeGreaterThan(0);
	});

	it("pins every kit runtime dependency through catalog:effected:exact", () => {
		const loose = kitDependencies.filter(([, spec]) => spec !== "catalog:effected:exact");
		expect(loose).toEqual([]);
	});

	it("seals the closure: every kit peer declared here, every @tsdoctor/* kit dependency exact", () => {
		const declared = new Set(Object.keys(manifest.dependencies ?? {}));
		const missing: Array<string> = [];
		const looseCore: Array<string> = [];
		const seen = new Set<string>();
		const walk = (dir: string): void => {
			if (seen.has(dir)) return;
			seen.add(dir);
			const pkg = readManifest(dir);
			if (pkg.name.startsWith("@tsdoctor/")) {
				for (const [name, spec] of Object.entries(pkg.dependencies ?? {})) {
					if (isKit(name) && spec !== "catalog:effected:exact") looseCore.push(`${pkg.name} -> ${name}@${spec}`);
				}
			}
			for (const peer of Object.keys(pkg.peerDependencies ?? {})) {
				if (isKit(peer) && !declared.has(peer) && pkg.peerDependenciesMeta?.[peer]?.optional !== true) {
					missing.push(`${pkg.name} -> ${peer}`);
				}
			}
			for (const name of [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]) {
				if (!isClosure(name)) continue;
				const next = resolveDir(dir, name);
				if (next !== undefined) walk(next);
			}
		};
		walk(packageRoot);
		expect(seen.size).toBeGreaterThan(1);
		expect(missing).toEqual([]);
		expect(looseCore).toEqual([]);
	});
});
