/**
 * Compile one file of a reconstructed VFS the way an adapter hands it to
 * Twoslash: every entry point's external `import type` lines prepended, every
 * VFS file resolvable (so one entry point can import a sibling through the
 * package's `exports` map), `skipLibCheck` off.
 */

import type { ApiEntryPoint } from "@microsoft/api-extractor-model";
import ts from "typescript";
import type { ApiExtractedPackage } from "../../src/index.js";
import { TypeReferenceExtractor } from "../../src/index.js";

const libSourceFileCache = new Map<string, ts.SourceFile>();

/** The package's VFS, rooted at `/`, with external imports prepended per entry point. */
export function preparedVfs(reconstructed: ApiExtractedPackage): Map<string, string> {
	const files = new Map<string, string>();
	for (const [file, content] of reconstructed.toVfs()) files.set(`/${file}`, content);
	const extractor = new TypeReferenceExtractor(reconstructed.apiPackage, reconstructed.apiPackage.name);
	for (const entryPoint of reconstructed.apiPackage.entryPoints) {
		const entry = entryPoint as ApiEntryPoint;
		const statements = TypeReferenceExtractor.formatImports(extractor.extractImportsForEntryPoint(entry));
		const file = `/node_modules/${reconstructed.name}/${entry.displayName ? `${entry.displayName}.d.ts` : "index.d.ts"}`;
		const existing = files.get(file);
		if (existing && statements.length > 0) files.set(file, `${statements.join("\n")}\n\n${existing}`);
	}
	return files;
}

/**
 * Diagnostic messages for `root` (and anything it imports from the VFS),
 * excluding unresolvable external modules, which a standalone compile cannot
 * provide.
 */
export function vfsNameDiagnostics(files: ReadonlyMap<string, string>, root: string): string[] {
	const options: ts.CompilerOptions = {
		noEmit: true,
		skipLibCheck: false,
		target: ts.ScriptTarget.ESNext,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		types: [],
	};
	const host = ts.createCompilerHost(options, true);
	const originalGetSourceFile = host.getSourceFile.bind(host);
	host.getCurrentDirectory = () => "/";
	host.getSourceFile = (name, lang, onError, shouldCreate) => {
		const content = files.get(name);
		if (content !== undefined) return ts.createSourceFile(name, content, lang, true);
		const cached = libSourceFileCache.get(name);
		if (cached !== undefined) return cached;
		const parsed = originalGetSourceFile(name, lang, onError, shouldCreate);
		if (parsed !== undefined) libSourceFileCache.set(name, parsed);
		return parsed;
	};
	host.fileExists = (name) => files.has(name) || ts.sys.fileExists(name);
	host.readFile = (name) => files.get(name) ?? ts.sys.readFile(name);
	host.directoryExists = (name) =>
		[...files.keys()].some((file) => file.startsWith(`${name.replace(/\/$/, "")}/`)) ||
		(ts.sys.directoryExists?.(name) ?? false);
	return ts
		.getPreEmitDiagnostics(ts.createProgram([root], options, host))
		.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "))
		.filter((m) => !m.includes("Cannot find module"));
}
