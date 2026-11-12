/**
 * The adapter is what consumers install, so it seals its whole kit closure,
 * all the way down: every `effect`, `@effect/*` and `@effected/*` package
 * reachable from it through a regular dependency or a required peer, at any
 * depth, is declared here as a runtime dependency spelled
 * `catalog:effected:exact`. Upstream kit packages reach each other through
 * carets; npm and pnpm both resolve such a transitive caret onto the copy
 * the adapter pins, so the flattened declaration is what holds the closure
 * to one tested version of each package. The `@tsdoctor/*` libraries it
 * ships pin their own regular kit dependencies the same way. A kit patch
 * then never reaches a consumer without a release of this package.
 *
 * Optional peers are left out: the closure never installs them, and a host
 * that installs one chooses its version.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

interface Manifest {
	readonly name: string;
	readonly version: string;
	readonly dependencies?: Record<string, string>;
	readonly peerDependencies?: Record<string, string>;
	readonly peerDependenciesMeta?: Record<string, { readonly optional?: boolean }>;
}

const packageRoot = path.resolve(import.meta.dirname, "..");
const readManifest = (dir: string): Manifest =>
	JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as Manifest;
const manifest = readManifest(packageRoot);
const declared = manifest.dependencies ?? {};

const isKit = (name: string): boolean => /^(effect$|@effect\/|@effected\/)/.test(name);
const isClosure = (name: string): boolean => isKit(name) || name.startsWith("@tsdoctor/");

const resolveDir = (from: string, name: string): string | undefined => {
	for (let dir = from; ; dir = path.dirname(dir)) {
		const candidate = path.join(dir, "node_modules", name);
		if (fs.existsSync(path.join(candidate, "package.json"))) return fs.realpathSync(candidate);
		if (path.dirname(dir) === dir) return undefined;
	}
};

/** Every package directory reachable through regular dependencies and required peers. */
const walkClosure = (): ReadonlyArray<{ readonly dir: string; readonly pkg: Manifest }> => {
	const seen = new Map<string, Manifest>();
	const walk = (dir: string): void => {
		if (seen.has(dir)) return;
		const pkg = readManifest(dir);
		seen.set(dir, pkg);
		const requiredPeers = Object.keys(pkg.peerDependencies ?? {}).filter(
			(peer) => pkg.peerDependenciesMeta?.[peer]?.optional !== true,
		);
		for (const name of [...Object.keys(pkg.dependencies ?? {}), ...requiredPeers]) {
			if (!isClosure(name)) continue;
			const next = resolveDir(dir, name);
			if (next !== undefined) walk(next);
		}
	};
	walk(packageRoot);
	return [...seen].map(([dir, pkg]) => ({ dir, pkg }));
};

describe("kit closure pins", () => {
	const kitDependencies = Object.entries(declared).filter(([name]) => isKit(name));
	const closure = walkClosure();
	const kitPackages = closure.filter(({ dir, pkg }) => dir !== packageRoot && isKit(pkg.name));

	it("declares kit runtime dependencies and reaches kit packages", () => {
		expect(kitDependencies.length).toBeGreaterThan(0);
		expect(kitPackages.length).toBeGreaterThan(kitDependencies.length / 2);
	});

	it("pins every kit runtime dependency through catalog:effected:exact", () => {
		const loose = kitDependencies.filter(([, spec]) => spec !== "catalog:effected:exact");
		expect(loose).toEqual([]);
	});

	it("declares every kit package of its closure, at any depth", () => {
		const undeclared = [...new Set(kitPackages.map(({ pkg }) => pkg.name))].filter((name) => !(name in declared));
		expect(undeclared).toEqual([]);
	});

	it("resolves one version of each kit package in its closure", () => {
		const versions = new Map<string, Set<string>>();
		for (const { pkg } of kitPackages) {
			versions.set(pkg.name, (versions.get(pkg.name) ?? new Set()).add(pkg.version));
		}
		const split = [...versions].filter(([, set]) => set.size > 1).map(([name, set]) => `${name}@${[...set].join(",")}`);
		expect(split).toEqual([]);
	});

	it("ships @tsdoctor/* libraries whose regular kit dependencies are exact", () => {
		const loose = closure
			.filter(({ pkg }) => pkg.name.startsWith("@tsdoctor/"))
			.flatMap(({ pkg }) =>
				Object.entries(pkg.dependencies ?? {})
					.filter(([name, spec]) => isKit(name) && spec !== "catalog:effected:exact")
					.map(([name, spec]) => `${pkg.name} -> ${name}@${spec}`),
			);
		expect(loose).toEqual([]);
	});
});
