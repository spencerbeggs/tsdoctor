/**
 * Display/source preparation for code-bearing blocks — hidden-import
 * prepending, Twoslash directive stripping and Prettier formatting — so both
 * fields of a {@link CodeText} are produced once, here, and never derived
 * from each other in an emitter.
 *
 * @remarks
 * Formatting lives in the IR package deliberately. Prettier is CPU-bound and
 * I/O-free, and both adapters must format identically or a shared golden
 * gate is impossible and llms output diverges between frameworks. The RSPress
 * generators already ran it before placing text in a prop; this is a move,
 * not a new step.
 *
 * @packageDocumentation
 */

import type { ImportStatement } from "@tsdoctor/model";
import { TypeReferenceExtractor } from "@tsdoctor/model";
import { Effect, Schema } from "effect";
import { format as prettierFormat } from "prettier";

import { CodeText, Example } from "./Blocks.js";
import { classifyCutDirective, isTwoslashDirective } from "./TwoslashDirectives.js";

/**
 * Prettier could not format an example.
 *
 * @remarks
 * Malformed example code is author input, so this is a typed failure rather
 * than a defect. The original Prettier error rides in `cause` rather than
 * being flattened to a string; an adapter that reports it (the RSPress
 * `PrettierError` event) reads the message from there and falls back to the
 * unformatted code.
 *
 * @public
 */
export class ExampleFormatError extends Schema.TaggedError<ExampleFormatError>("ExampleFormatError")(
	"ExampleFormatError",
	{
		/** The fence language the parser was chosen for. */
		language: Schema.String,
		/** The original Prettier error. */
		cause: Schema.Defect(),
	},
) {
	get message(): string {
		return `Prettier could not format a ${this.language} example`;
	}
}

/**
 * A raw example as extracted from TSDoc.
 *
 * @public
 */
export interface RawExample {
	/** The fence language as written. */
	readonly language: string;
	/** The fence body. */
	readonly code: string;
}

/**
 * An example prepared for Twoslash: the import line and the `@noErrors`
 * directive added, and the language normalized.
 *
 * @public
 */
export interface PreparedExample {
	/** The code with the package import and directives prepended. */
	readonly code: string;
	/** Whether the example is TypeScript/JavaScript and therefore type-checked. */
	readonly isTypeScript: boolean;
	/** The normalized language: `typescript` for TS/JS, otherwise as written. */
	readonly language: string;
}

const TYPESCRIPT_LANGUAGES = new Set(["typescript", "ts", "javascript", "js"]);

/**
 * Prepare an example for Twoslash: prepend `import { name } from "pkg"`
 * unless the example already imports the package, and prepend `// @noErrors`
 * when errors are suppressed. Non-TypeScript examples pass through untouched.
 *
 * @param example - The example with language and code
 * @param apiItemName - The documented item, imported at the top of the example
 * @param packageName - The package to import it from
 * @param suppressErrors - Whether to suppress TypeScript errors (default `true`)
 * @public
 */
export function prepareExampleCode(
	example: RawExample,
	apiItemName: string,
	packageName: string,
	suppressErrors: boolean = true,
): PreparedExample {
	const { language, code } = example;
	if (!TYPESCRIPT_LANGUAGES.has(language)) {
		return { code, isTypeScript: false, language };
	}

	// TSDoc examples may quote the specifier either way.
	const importLine = `import { ${apiItemName} } from "${packageName}";`;
	const hasImport = code.includes(`from "${packageName}"`) || code.includes(`from '${packageName}'`);
	const finalCode = hasImport ? code : `${importLine}\n${code}`;
	const errorDirective = suppressErrors ? "// @noErrors\n" : "";

	return { code: `${errorDirective}${finalCode}`, isTypeScript: true, language: "typescript" };
}

/**
 * Strip Twoslash directives from code for display: config directives
 * (`// @noErrors`, `// @errors: 2304`, `// @filename: …`), annotation markers
 * (`// ^?`) and the cut directives — `// ---cut---` removes itself and every
 * line before it, `// ---cut-after---` itself and every line after, and a
 * `// ---cut-start---` / `// ---cut-end---` pair removes the range between.
 *
 * @param code - The code containing Twoslash directives
 * @returns The code a reader sees and copies
 * @public
 */
export function stripTwoslashDirectives(code: string): string {
	const lines = code.split("\n");

	let cutBeforeIndex = -1;
	let cutAfterIndex = -1;
	const cutRanges: Array<[start: number, end: number]> = [];
	const cutStartStack: number[] = [];

	for (let i = 0; i < lines.length; i++) {
		const cutType = classifyCutDirective(lines[i].trim());
		if (cutType === "cut-before") {
			cutBeforeIndex = i;
		} else if (cutType === "cut-after") {
			cutAfterIndex = i;
		} else if (cutType === "cut-start") {
			cutStartStack.push(i);
		} else if (cutType === "cut-end") {
			const startIdx = cutStartStack.pop();
			if (startIdx !== undefined) {
				cutRanges.push([startIdx, i]);
			}
		}
	}

	let filteredLines = lines;
	if (cutBeforeIndex >= 0) {
		filteredLines = filteredLines.slice(cutBeforeIndex + 1);
		if (cutAfterIndex >= 0) {
			cutAfterIndex = cutAfterIndex - cutBeforeIndex - 1;
		}
		for (const range of cutRanges) {
			range[0] -= cutBeforeIndex + 1;
			range[1] -= cutBeforeIndex + 1;
		}
	}

	if (cutAfterIndex >= 0) {
		filteredLines = filteredLines.slice(0, cutAfterIndex);
	}

	const excludedLines = new Set<number>();
	for (const [start, end] of cutRanges) {
		for (let i = start; i <= end; i++) {
			if (i >= 0 && i < filteredLines.length) {
				excludedLines.add(i);
			}
		}
	}

	return filteredLines
		.filter((line, i) => !excludedLines.has(i) && !isTwoslashDirective(line.trim()))
		.join("\n")
		.trim();
}

/**
 * Prepend hidden imports to code using the Twoslash cut directive, so the
 * type-checker resolves external types while the reader never sees the
 * import lines. Returns the code unchanged when there is nothing to import.
 *
 * @param code - The code to prepend imports to
 * @param imports - The import statements to add
 * @public
 */
export function prependHiddenImports(code: string, imports: ReadonlyArray<ImportStatement>): string {
	if (imports.length === 0) {
		return code;
	}
	const formatted = TypeReferenceExtractor.formatImports([...imports]);
	return `${formatted.join("\n")}\n// ---cut---\n${code}`;
}

/**
 * Build both spellings of a code block from its type-check text: the
 * `source` as given, the `display` with every directive stripped.
 *
 * @param source - The type-check text — hidden imports, cut marker, directives intact
 * @public
 */
export function codeText(source: string): CodeText {
	return CodeText.make({ display: stripTwoslashDirectives(source), source });
}

/**
 * Add logical blank lines between code sections for visual clarity: after an
 * import block, before a section comment and before a `return`.
 *
 * @remarks
 * Runs after Prettier, which does not insert breathing room of its own. Lines
 * inside a multi-line import and Twoslash directive lines never trigger a
 * rule, so a directive stays attached to the line it annotates.
 *
 * @param code - Prettier-formatted code
 * @public
 */
export function addLogicalBlankLines(code: string): string {
	const lines = code.split("\n");
	const result: string[] = [];
	let inMultiLineImport = false;

	for (const line of lines) {
		const trimmed = line.trim();

		const wasInMultiLineImport = inMultiLineImport;
		if (!inMultiLineImport && trimmed.startsWith("import ") && !trimmed.endsWith(";")) {
			inMultiLineImport = true;
		} else if (inMultiLineImport && trimmed.endsWith(";")) {
			inMultiLineImport = false;
		}

		const isCurrentImport = trimmed.startsWith("import ") || wasInMultiLineImport;

		if (result.length > 0 && !isCurrentImport) {
			const prevTrimmed = result[result.length - 1].trim();

			if (prevTrimmed !== "") {
				const isDirective = isTwoslashDirective(trimmed);

				// `import { x } from "y";` or the closing `} from "y";` of a multi-line import.
				const prevIsImportEnd =
					(prevTrimmed.startsWith("import ") && prevTrimmed.endsWith(";")) ||
					(/}\s*from\s+/.test(prevTrimmed) && prevTrimmed.endsWith(";"));

				if (prevIsImportEnd && trimmed !== "" && !isDirective) {
					result.push("");
				}

				if (trimmed.startsWith("//") && !isDirective && !prevTrimmed.startsWith("//") && !prevIsImportEnd) {
					result.push("");
				}

				if (/^return[\s;(]/.test(trimmed) && !prevTrimmed.startsWith("//")) {
					result.push("");
				}
			}
		}

		result.push(line);
	}

	return result.join("\n");
}

/** Fence languages Prettier can format, mapped to its parser name. */
const LANGUAGE_TO_PARSER: Readonly<Record<string, string>> = {
	typescript: "typescript",
	ts: "typescript",
	tsx: "typescript",
	javascript: "babel",
	js: "babel",
	jsx: "babel",
	node: "babel",
};

/** The one Prettier configuration every adapter formats examples with. */
const PRETTIER_OPTIONS = {
	printWidth: 80,
	tabWidth: 2,
	useTabs: false,
	semi: true,
	singleQuote: false,
	trailingComma: "es5" as const,
	bracketSpacing: true,
	arrowParens: "always" as const,
};

/**
 * Format example code with Prettier, then add logical blank lines. A
 * language Prettier has no parser for is returned unchanged.
 *
 * @param code - The code to format
 * @param language - The fence language (`typescript`, `ts`, `js`, …)
 * @public
 */
export const formatExampleCode: (code: string, language: string) => Effect.Effect<string, ExampleFormatError> =
	Effect.fn("Examples.formatExampleCode")(function* (code: string, language: string) {
		const parser = LANGUAGE_TO_PARSER[language.toLowerCase()];
		if (!parser) {
			return code;
		}
		const formatted = yield* Effect.tryPromise({
			try: () => prettierFormat(code, { ...PRETTIER_OPTIONS, parser }),
			catch: (cause) => new ExampleFormatError({ language, cause }),
		});
		return addLogicalBlankLines(formatted.trim());
	});

/**
 * Build an {@link Example} block item from a raw TSDoc example: prepare it
 * for Twoslash, format it, and produce both code spellings once.
 *
 * @remarks
 * A non-TypeScript example is not type-checked, so its `display` and
 * `source` are the same formatted text and emitters render it in a plain
 * fence.
 *
 * @param example - The example with language and code
 * @param apiItemName - The documented item, imported at the top of the example
 * @param packageName - The package to import it from
 * @param suppressErrors - Whether to suppress TypeScript errors (default `true`)
 * @public
 */
export const buildExample: (
	example: RawExample,
	apiItemName: string,
	packageName: string,
	suppressErrors?: boolean,
) => Effect.Effect<Example, ExampleFormatError> = Effect.fn("Examples.buildExample")(function* (
	example: RawExample,
	apiItemName: string,
	packageName: string,
	suppressErrors: boolean = true,
) {
	const prepared = prepareExampleCode(example, apiItemName, packageName, suppressErrors);
	const formatted = yield* formatExampleCode(prepared.code, prepared.language);
	return Example.make({
		language: prepared.language,
		code: prepared.isTypeScript ? codeText(formatted) : CodeText.make({ display: formatted, source: formatted }),
		typeChecked: prepared.isTypeScript,
	});
});
