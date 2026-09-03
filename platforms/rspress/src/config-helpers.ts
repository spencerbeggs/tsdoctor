import fs from "node:fs";
import path from "node:path";
import type { BundleDescriptor } from "@tsdoctor/bundle";
import { discoverBundle } from "@tsdoctor/bundle";
import { normalizeBaseRoute } from "@tsdoctor/pages";
import { Effect, Result } from "effect";
import type { MultiApiConfig } from "./schemas/config.js";
import { SyncDiscoveryLayer } from "./sync-node-fs.js";

/**
 * Metadata discovered from a single rslib-builder localPaths package folder.
 *
 * @public
 */
export interface DirInfo {
	/** Absolute path to the package folder. */
	dir: string;
	/** Last path segment of `dir`, e.g. "sdk". */
	dirname: string;
	/** package.json "name", e.g. "vitest-agent-sdk" or "\@scope/pkg". */
	packageName: string;
	/** package.json "version" (empty string if absent). */
	version: string;
	/** Absolute path to the resolved *.api.json model. */
	modelPath: string;
}

/**
 * How to derive an API's `baseRoute`. One of:
 *
 * - omitted — leaves `baseRoute` unset so the plugin applies its own
 *   context-aware default: the API folder root (`/api`) under the single-API
 *   `api:` option, or `/{packageName}/api` under the multi-API `apis:` option.
 * - a template string — supports the `{dirname}` and `{packageName}` tokens,
 *   e.g. `"reference/{dirname}"`. A leading slash is normalized in.
 * - a callback — `(info) => string` for full control.
 *
 * Note: the `{packageName}` token is interpolated verbatim, so for a scoped
 * package it yields the scope too (e.g. `@scope/bar`), which is rarely what you
 * want inside a URL path. Prefer `{dirname}` (the folder name, which is the
 * unscoped name in the rslib-builder layout) or the callback form.
 *
 * @public
 */
export type BaseRoute = string | ((info: DirInfo) => string);

/**
 * Overrides for `api.fromDir`. Any `MultiApiConfig` field wins over discovery.
 *
 * @public
 */
export type FromDirOptions = Omit<Partial<MultiApiConfig>, "baseRoute"> & {
	baseRoute?: BaseRoute;
	/** Base for resolving a relative `dir`. Defaults to process.cwd(). */
	cwd?: string;
};

const PREFIX = "[rspress-plugin-api-extractor]";

/**
 * The adapter's strictness gate over `@tsdoctor/bundle`'s layer-0-only
 * discovery: the plugin's public contract requires a `package.json` with a
 * `name` (the bundle spec does not), so the gate runs FIRST and keeps the
 * historical error messages. Returning the parsed name/version also lets the
 * bundle discovery skip its api.json name fallback entirely (the model file
 * is never parsed here, exactly as before).
 */
function requirePackageJson(dir: string): { name: string; version?: string } {
	let stat: fs.Stats;
	try {
		stat = fs.statSync(dir);
	} catch {
		throw new Error(`${PREFIX} api.fromDir: directory not found: ${dir}`);
	}
	if (!stat.isDirectory()) {
		throw new Error(`${PREFIX} api.fromDir: not a directory: ${dir}`);
	}
	let pkg: { name?: string; version?: string };
	try {
		pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as { name?: string; version?: string };
	} catch {
		throw new Error(`${PREFIX} api.fromDir: missing or unreadable package.json in ${dir}`);
	}
	if (!pkg.name) {
		throw new Error(`${PREFIX} api.fromDir: package.json in ${dir} has no "name" field`);
	}
	return { name: pkg.name, ...(pkg.version !== undefined ? { version: pkg.version } : {}) };
}

/**
 * Run `@tsdoctor/bundle`'s `discoverBundle` synchronously (over the sync
 * `FileSystem` bridge — see `sync-node-fs.ts`) and translate its typed
 * failures into the plugin's historical error messages.
 */
function discoverDescriptor(dir: string, name: string, version: string | undefined): BundleDescriptor {
	const result = Effect.runSync(
		Effect.result(
			discoverBundle(dir, { overrides: { name, ...(version !== undefined ? { version } : {}) } }).pipe(
				Effect.provide(SyncDiscoveryLayer),
			),
		),
	);
	if (Result.isSuccess(result)) {
		return result.success;
	}
	const error = result.failure;
	if (error._tag === "BundleDiscoveryError") {
		switch (error.reason) {
			case "noApiModel":
				throw new Error(
					`${PREFIX} api.fromDir: no *.api.json model found in ${dir}. Pass an explicit \`model\` to override.`,
				);
			case "ambiguousApiModel": {
				// The discovery detail reads `multiple *.api.json files (a, b) and
				// none match "x.api.json"; …` — keep its facts, swap in the plugin's
				// own guidance.
				const facts = (error.detail ?? "multiple *.api.json files").split(";")[0];
				throw new Error(`${PREFIX} api.fromDir: ${facts} in ${dir}. Pass an explicit \`model\`.`);
			}
			case "notFound":
				throw new Error(`${PREFIX} api.fromDir: directory not found: ${dir}`);
			case "notADirectory":
				throw new Error(`${PREFIX} api.fromDir: not a directory: ${dir}`);
			default:
				throw new Error(`${PREFIX} api.fromDir: ${error.message}`);
		}
	}
	throw new Error(`${PREFIX} api.fromDir: ${String(error)}`);
}

function resolveBaseRoute(baseRoute: Exclude<BaseRoute, undefined>, info: DirInfo): string {
	const raw = typeof baseRoute === "function" ? baseRoute(info) : baseRoute;
	const interpolated = raw.replace(/\{dirname\}/g, info.dirname).replace(/\{packageName\}/g, info.packageName);
	return normalizeBaseRoute(interpolated);
}

/**
 * Build a `MultiApiConfig` by discovering fields from a single package folder
 * produced by `@savvy-web/rslib-builder`'s `localPaths` option. Exposed as
 * `ApiExtractorPlugin.api.fromDir`; the returned config can be passed to the
 * single-API `api:` option or used as an element of the multi-API `apis:` array.
 *
 * Discovery (model-file selection, unscoped-name disambiguation, tsconfig
 * detection) delegates to `@tsdoctor/bundle`'s `discoverBundle`; the
 * RSPress-specific concerns — `baseRoute` templating and `MultiApiConfig`
 * assembly — stay here, as does the plugin's stricter contract that the
 * folder carry a named `package.json` (the bundle spec itself accepts
 * layer-0-only folders).
 *
 * `baseRoute` is intentionally left unset unless overridden, so the plugin
 * applies its own context-aware default (`/api` under `api:`,
 * `/{packageName}/api` under `apis:`). See {@link BaseRoute}.
 */
export function fromDir(dir: string, overrides: FromDirOptions = {}): MultiApiConfig {
	const { baseRoute, cwd, ...rest } = overrides;
	const abs = path.resolve(cwd ?? process.cwd(), dir);
	const pkg = requirePackageJson(abs);
	const descriptor = discoverDescriptor(abs, pkg.name, pkg.version);
	const info: DirInfo = {
		dir: descriptor.dir,
		dirname: descriptor.dirname,
		packageName: descriptor.name,
		version: descriptor.version ?? "",
		modelPath: descriptor.modelPath,
	};

	const discovered: MultiApiConfig = {
		packageName: info.packageName,
		name: info.packageName,
		model: info.modelPath,
		packageJson: path.join(info.dir, "package.json"),
		...(baseRoute !== undefined ? { baseRoute: resolveBaseRoute(baseRoute, info) } : {}),
		...(descriptor.tsconfigPath !== undefined ? { tsconfig: descriptor.tsconfigPath } : {}),
	};

	// Caller-supplied fields win over discovery (shallow merge). `baseRoute`/`cwd`
	// are consumed above and never passed through onto the config object.
	return { ...discovered, ...rest };
}

function isModelFolder(dir: string): boolean {
	if (!fs.existsSync(path.join(dir, "package.json"))) {
		return false;
	}
	try {
		return fs.readdirSync(dir).some((f) => f.endsWith(".api.json"));
	} catch {
		return false;
	}
}

/**
 * Strictly scan a parent directory of package folders and build one
 * `MultiApiConfig` per subfolder. Exposed as `ApiExtractorPlugin.apis.fromDir`;
 * the returned array is intended for the multi-API `apis:` option. Every
 * non-dotfile subdirectory MUST be a valid model folder — including a
 * `package.json`, which is this adapter's stricter contract over the bundle
 * spec's layer-0-only discovery. `options` (minus `cwd`) is applied as shared
 * defaults to each `api.fromDir` call.
 */
export function fromParentDir(parentDir: string, options: FromDirOptions = {}): MultiApiConfig[] {
	const { cwd, ...rest } = options;
	const absParent = path.resolve(cwd ?? process.cwd(), parentDir);

	let stat: fs.Stats;
	try {
		stat = fs.statSync(absParent);
	} catch {
		throw new Error(`${PREFIX} apis.fromDir: directory not found: ${absParent}`);
	}
	if (!stat.isDirectory()) {
		throw new Error(`${PREFIX} apis.fromDir: not a directory: ${absParent}`);
	}

	const subdirs = fs
		.readdirSync(absParent, { withFileTypes: true })
		.filter((e) => e.isDirectory() && !e.name.startsWith("."))
		.map((e) => e.name)
		.sort();

	const configs: MultiApiConfig[] = [];
	for (const name of subdirs) {
		const subdir = path.join(absParent, name);
		if (!isModelFolder(subdir)) {
			throw new Error(
				`${PREFIX} apis.fromDir: "${name}" in ${absParent} is not a valid model folder (needs package.json and a *.api.json). Use api.fromDir for selective inclusion.`,
			);
		}
		configs.push(fromDir(subdir, rest));
	}

	if (configs.length === 0) {
		throw new Error(
			`${PREFIX} apis.fromDir: no model folders found in ${absParent}. Have the package models been built?`,
		);
	}

	return configs;
}
