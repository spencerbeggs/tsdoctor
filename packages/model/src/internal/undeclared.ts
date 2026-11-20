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
 * Twoslash hover in a block that touches the entry point. A name a sibling
 * entry point exports is imported from that entry; any other name gets a
 * non-exported `any` stub (a type and a value, so heritage clauses resolve),
 * which keeps the rest of the file type-checking without adding the name to
 * the entry point's exports.
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
 * What an entry point needs beyond its own members: imports of names a
 * sibling entry point exports, and stubs for names nothing exports.
 */
export interface UndeclaredResolution {
	/** `import { … } from "<package>/<entry>"` lines, one per sibling entry. */
	readonly imports: readonly string[];
	/** The stub block, or `""` when nothing needs stubbing. */
	readonly stubs: string;
}

/**
 * Resolve the names an entry point references but does not declare: import
 * the ones a sibling entry point exports, stub the rest.
 *
 * @param entryPoint - The entry point being reconstructed
 * @param packageName - The canonical package name of the documented package
 * @param renderToken - How the reconstruction spells a token (alias-normalized)
 * @param siblingExports - Name to module specifier for every member of the package's other entry points
 */
export function resolveUndeclared(
	entryPoint: ApiEntryPoint,
	packageName: string,
	renderToken: (token: ExcerptToken) => string,
	siblingExports: ReadonlyMap<string, string>,
): UndeclaredResolution {
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

	const siblingImports = new Map<string, Set<string>>();
	const roots = new Map<string, StubNode>();
	for (const { path, arity } of candidates) {
		const [root] = path;
		if (!root || declared.has(root) || resolvedRoots.has(root) || AMBIENT_ROOTS.has(root)) continue;
		const specifier = siblingExports.get(root);
		if (specifier !== undefined) {
			let names = siblingImports.get(specifier);
			if (!names) {
				names = new Set();
				siblingImports.set(specifier, names);
			}
			names.add(root);
			continue;
		}
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

	// A plain (not type-only) import: a sibling class may sit in an `extends` clause.
	const imports = [...siblingImports]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([specifier, names]) => `import { ${[...names].sort().join(", ")} } from "${specifier}";`);
	if (roots.size === 0) return { imports, stubs: "" };

	const lines = [
		"// Referenced by this entry point but neither exported nor resolvable in the API model;",
		"// declared as `any` so the rest of the file type-checks.",
	];
	for (const [name, node] of [...roots].sort(([a], [b]) => a.localeCompare(b))) {
		renderNode(name, node, "", true, lines);
	}
	return { imports, stubs: lines.join("\n") };
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
		// The matching value: a heritage clause (`extends Foo_base`) is a value
		// position, which a type alias alone answers with TS2693.
		lines.push(`${indent}${keyword} const ${name}: any;`);
	}
	if (node.children.size > 0) {
		lines.push(`${indent}${keyword} namespace ${name} {`);
		for (const [child, childNode] of [...node.children].sort(([a], [b]) => a.localeCompare(b))) {
			renderNode(child, childNode, `${indent}\t`, false, lines);
		}
		lines.push(`${indent}}`);
	}
}
