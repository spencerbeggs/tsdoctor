/**
 * Stub declarations for names a reconstructed entry point references but
 * nothing declares.
 *
 * Two shapes reach a reconstructed `.d.ts` undeclared:
 *
 * - an internal reference (canonical package is the documented one) to a
 *   symbol the entry point does not export — a forgotten export, when the
 *   package's API Extractor run leaves `includeForgottenExports` off. The
 *   import prepender rightly skips internal references, so nothing declares it.
 * - a dotted name inside a `Content` token, which is how API Extractor spells a
 *   reference it could not resolve: there is no canonical reference to
 *   classify, so nothing imports it.
 *
 * Either one fails the whole file (TS2304 / TS2503), which poisons every
 * Twoslash hover in a block that touches the entry point. A non-exported
 * `any` stub keeps the rest of the file type-checking without adding the name
 * to the entry point's exports.
 *
 * @internal
 */

import type { ApiEntryPoint, ApiItem, ExcerptToken } from "@microsoft/api-extractor-model";
import { ApiDeclaredItem, ExcerptTokenKind } from "@microsoft/api-extractor-model";

/**
 * Global namespaces a dotted `Content` name may legitimately start with. A
 * stub of one would shadow the real declaration, so these are never stubbed.
 */
const AMBIENT_ROOTS = new Set([
	"Array",
	"Atomics",
	"BigInt",
	"CSS",
	"Date",
	"Error",
	"Intl",
	"JSON",
	"JSX",
	"Math",
	"NodeJS",
	"Number",
	"Object",
	"Promise",
	"React",
	"Reflect",
	"String",
	"Symbol",
	"WebAssembly",
	"console",
	"globalThis",
	"import",
	"this",
]);

/** A dotted identifier path not itself preceded by an identifier character or a dot. */
const DOTTED_NAME = /(?<![\w$.])[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+/g;

/** String and template literals, whose contents are never names. */
const STRING_LITERAL = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

interface Candidate {
	readonly path: readonly string[];
	readonly arity: number;
}

interface StubNode {
	isType: boolean;
	arity: number;
	readonly children: Map<string, StubNode>;
}

/**
 * Render the stub block for one entry point, or `""` when every referenced
 * name is declared, imported or global.
 *
 * @param entryPoint - The entry point being reconstructed
 * @param packageName - The canonical package name of the documented package
 * @param renderToken - How the reconstruction spells a token (alias-normalized)
 */
export function undeclaredStubs(
	entryPoint: ApiEntryPoint,
	packageName: string,
	renderToken: (token: ExcerptToken) => string,
): string {
	const declared = new Set(entryPoint.members.map((member) => member.displayName));
	// Roots some reference resolves outside this file: external imports the
	// prepender adds, and lib globals. Stubbing one would collide with it.
	const resolvedRoots = new Set<string>();
	const candidates: Candidate[] = [];

	const visit = (item: ApiItem): void => {
		if (item instanceof ApiDeclaredItem) {
			collect(item.excerptTokens, packageName, renderToken, declared, resolvedRoots, candidates);
		}
		for (const member of item.members) visit(member);
	};
	for (const member of entryPoint.members) visit(member);

	const roots = new Map<string, StubNode>();
	for (const { path, arity } of candidates) {
		const [root] = path;
		if (!root || declared.has(root) || resolvedRoots.has(root) || AMBIENT_ROOTS.has(root)) continue;
		let level = roots;
		let node: StubNode | undefined;
		for (const segment of path) {
			node = level.get(segment);
			if (!node) {
				node = { isType: false, arity: 0, children: new Map() };
				level.set(segment, node);
			}
			level = node.children;
		}
		if (node) {
			node.isType = true;
			node.arity = Math.max(node.arity, arity);
		}
	}
	if (roots.size === 0) return "";

	const lines = [
		"// Referenced by this entry point but neither exported nor resolvable in the API model;",
		"// declared as `any` so the rest of the file type-checks.",
	];
	for (const [name, node] of [...roots].sort(([a], [b]) => a.localeCompare(b))) {
		renderNode(name, node, "", true, lines);
	}
	return lines.join("\n");
}

function collect(
	tokens: readonly ExcerptToken[],
	packageName: string,
	renderToken: (token: ExcerptToken) => string,
	declared: ReadonlySet<string>,
	resolvedRoots: Set<string>,
	candidates: Candidate[],
): void {
	const texts = tokens.map(renderToken);
	const full = texts.join("");
	const masked = full.replace(STRING_LITERAL, (literal) => " ".repeat(literal.length));
	const contentRanges: Array<readonly [number, number]> = [];

	let offset = 0;
	tokens.forEach((token, index) => {
		const text = texts[index] ?? "";
		const start = offset;
		offset += text.length;
		if (token.kind !== ExcerptTokenKind.Reference) {
			contentRanges.push([start, offset]);
			return;
		}
		const canonical = token.canonicalReference?.toString();
		if (!canonical) {
			contentRanges.push([start, offset]);
			return;
		}
		const path = text.trim().split(".");
		const [root] = path;
		if (!root) return;
		const bang = canonical.indexOf("!");
		if (bang === -1 || canonical.slice(0, bang) !== packageName) {
			resolvedRoots.add(root);
			return;
		}
		const symbol = canonical.slice(bang + 1).replace(/^~/, "");
		const symbolRoot = symbol.split(/[.#~:]/)[0] ?? "";
		if (declared.has(root) || declared.has(symbolRoot)) return;
		candidates.push({ path, arity: arityAt(masked, offset) });
	});

	for (const match of masked.matchAll(DOTTED_NAME)) {
		const start = match.index;
		const end = start + match[0].length;
		if (!contentRanges.some(([from, to]) => start >= from && start < to)) continue;
		// A value position (`typeof A.b`, `A.b(...)`) is not fixed by a type stub.
		if (/\btypeof\s+$/.test(masked.slice(0, start)) || masked[end] === "(") continue;
		candidates.push({ path: match[0].split("."), arity: arityAt(masked, end) });
	}
}

/**
 * The number of type arguments applied at `position`: 0 unless the next
 * non-space character opens a `<…>` list. Arrow `=>` is not a closer.
 */
function arityAt(text: string, position: number): number {
	let index = position;
	while (text[index] === " ") index++;
	if (text[index] !== "<") return 0;
	let depth = 0;
	let commas = 0;
	for (; index < text.length; index++) {
		const char = text[index];
		if (char === "<" || char === "(" || char === "[" || char === "{") depth++;
		else if (char === ">" || char === ")" || char === "]" || char === "}") {
			if (char === ">" && text[index - 1] === "=") continue;
			depth--;
			if (depth === 0) return commas + 1;
		} else if (char === "," && depth === 1) commas++;
	}
	return 0;
}

function renderNode(name: string, node: StubNode, indent: string, topLevel: boolean, lines: string[]): void {
	const keyword = topLevel ? "declare" : "export";
	if (node.isType) {
		const parameters = Array.from({ length: node.arity }, (_, i) => `T${i} = any`);
		const generic = parameters.length > 0 ? `<${parameters.join(", ")}>` : "";
		lines.push(`${indent}${keyword} type ${name}${generic} = any;`);
	}
	if (node.children.size > 0) {
		lines.push(`${indent}${keyword} namespace ${name} {`);
		for (const [child, childNode] of [...node.children].sort(([a], [b]) => a.localeCompare(b))) {
			renderNode(child, childNode, `${indent}\t`, false, lines);
		}
		lines.push(`${indent}}`);
	}
}
