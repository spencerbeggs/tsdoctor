/**
 * The adapter is what consumers install, so it seals its whole kit closure,
 * all the way down. Every `effect`, `@effect/*` and `@effected/*` runtime
 * dependency it declares is spelled `catalog:effected:exact`. Every kit
 * package its closure reaches through a range (a regular dependency or a
 * required peer, at any depth) is one of those declarations: npm and pnpm
 * both resolve a transitive range onto the copy the adapter pins, so the
 * flattened declaration holds the edge to one tested version. A package
 * reached only through exact upstream pins is already sealed and is not
 * redeclared. The `@tsdoctor/*` libraries it ships pin their own regular kit
 * dependencies exactly too. A kit patch then never reaches a consumer
 * without a release of this package.
 *
 * Every pin must also satisfy every published edge that reaches it, checked
 * against the edge's own range: this workspace's graph-wide Effect overrides
 * would otherwise hide a split that a consumer, without those overrides,
 * installs as two copies.
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

interface Edge {
	readonly from: string;
	readonly to: string;
	readonly spec: string;
}

const packageRoot = path.resolve(import.meta.dirname, "..");
const readManifest = (dir: string): Manifest =>
	JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as Manifest;
const manifest = readManifest(packageRoot);
const declared = manifest.dependencies ?? {};

const isKit = (name: string): boolean => /^(effect$|@effect\/|@effected\/)/.test(name);
const isClosure = (name: string): boolean => isKit(name) || name.startsWith("@tsdoctor/");

const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const RANGE = /^([~^])(\d+)\.(\d+)\.(\d+)$/;
/** `catalog:` and `workspace:` specs only appear on unpacked workspace manifests; the build resolves them. */
const isProtocolSpec = (spec: string): boolean => /^(catalog|workspace):/.test(spec);

const parse = (version: string): ReadonlyArray<number> => (version.split("-")[0] ?? "").split(".").map(Number);
const gte = (a: ReadonlyArray<number>, b: ReadonlyArray<number>): boolean => {
	for (let i = 0; i < 3; i++) {
		if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
	}
	return true;
};

/** Semver satisfaction for the spec forms kit manifests publish: exact, caret and tilde. */
const satisfies = (version: string, spec: string): boolean | "unsupported" => {
	if (EXACT.test(spec)) return version === spec;
	const match = RANGE.exec(spec);
	if (match === null) return "unsupported";
	const [, op, ...parts] = match;
	const floor = parts.map(Number);
	const v = parse(version);
	if (!gte(v, floor)) return false;
	const [major = 0, minor = 0] = floor;
	if (op === "~" || major === 0) {
		return v[0] === major && v[1] === minor && (op === "~" || minor > 0 || v[2] === floor[2]);
	}
	return v[0] === major;
};

const resolveDir = (from: string, name: string): string | undefined => {
	for (let dir = from; ; dir = path.dirname(dir)) {
		const candidate = path.join(dir, "node_modules", name);
		if (fs.existsSync(path.join(candidate, "package.json"))) return fs.realpathSync(candidate);
		if (path.dirname(dir) === dir) return undefined;
	}
};

/** Every package reachable through regular dependencies and required peers, with the edges between them. */
const walkClosure = (): {
	readonly packages: ReadonlyArray<{ readonly dir: string; readonly pkg: Manifest }>;
	readonly edges: ReadonlyArray<Edge>;
} => {
	const seen = new Map<string, Manifest>();
	const edges: Array<Edge> = [];
	const walk = (dir: string): void => {
		if (seen.has(dir)) return;
		const pkg = readManifest(dir);
		seen.set(dir, pkg);
		const requiredPeers = Object.entries(pkg.peerDependencies ?? {}).filter(
			([peer]) => pkg.peerDependenciesMeta?.[peer]?.optional !== true,
		);
		for (const [name, spec] of [...Object.entries(pkg.dependencies ?? {}), ...requiredPeers]) {
			if (!isClosure(name)) continue;
			if (dir !== packageRoot) edges.push({ from: `${pkg.name}@${pkg.version}`, to: name, spec });
			const next = resolveDir(dir, name);
			if (next !== undefined) walk(next);
		}
	};
	walk(packageRoot);
	return { packages: [...seen].map(([dir, pkg]) => ({ dir, pkg })), edges };
};

describe("kit closure pins", () => {
	const kitDependencies = Object.entries(declared).filter(([name]) => isKit(name));
	const { packages, edges } = walkClosure();
	const kitPackages = packages.filter(({ dir, pkg }) => dir !== packageRoot && isKit(pkg.name));
	const kitEdges = edges.filter(({ to, spec }) => isKit(to) && !isProtocolSpec(spec));
	const pinnedVersion = new Map(
		kitDependencies.flatMap(([name]) => {
			const dir = resolveDir(packageRoot, name);
			return dir === undefined ? [] : [[name, readManifest(dir).version] as const];
		}),
	);

	it("declares kit runtime dependencies and walks a real closure", () => {
		expect(kitDependencies.length).toBeGreaterThan(0);
		expect(pinnedVersion.size).toBe(kitDependencies.length);
		expect(kitEdges.length).toBeGreaterThan(kitDependencies.length);
	});

	it("pins every kit runtime dependency through catalog:effected:exact", () => {
		const loose = kitDependencies.filter(([, spec]) => spec !== "catalog:effected:exact");
		expect(loose).toEqual([]);
	});

	it("declares every kit package its closure reaches through a range, at any depth", () => {
		const floating = kitEdges
			.filter(({ to, spec }) => !EXACT.test(spec) && !(to in declared))
			.map(({ from, to, spec }) => `${from} -> ${to}@${spec}`);
		expect(floating).toEqual([]);
	});

	it("pins versions that satisfy every published edge reaching them", () => {
		const unsatisfied = kitEdges
			.filter(({ to }) => pinnedVersion.has(to))
			.flatMap(({ from, to, spec }) => {
				const result = satisfies(pinnedVersion.get(to) ?? "", spec);
				return result === true ? [] : [`${from} -> ${to}@${spec} (pinned ${pinnedVersion.get(to)}, ${result})`];
			});
		expect(unsatisfied).toEqual([]);
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
		const loose = packages
			.filter(({ pkg }) => pkg.name.startsWith("@tsdoctor/"))
			.flatMap(({ pkg }) =>
				Object.entries(pkg.dependencies ?? {})
					.filter(([name, spec]) => isKit(name) && spec !== "catalog:effected:exact")
					.map(([name, spec]) => `${pkg.name} -> ${name}@${spec}`),
			);
		expect(loose).toEqual([]);
	});
});
