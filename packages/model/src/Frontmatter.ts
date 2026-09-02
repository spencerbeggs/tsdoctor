import { FrontmatterSource, FrontmatterSourceBlock, FrontmatterSourceSplit } from "@effected/markdown";
import { Yaml, YamlStringifyOptions } from "@effected/yaml";
import { Effect } from "effect";

/**
 * A parsed frontmatter document: the decoded frontmatter data and the body
 * content that followed the closing delimiter.
 *
 * @public
 */
export interface ParsedFrontmatter {
	/** Decoded frontmatter data (`{}` when there is no frontmatter block). */
	readonly data: Record<string, unknown>;
	/** Body content after the closing delimiter (whole input when no block). */
	readonly content: string;
}

/**
 * Stringify options shared by both emit sites.
 *
 * `lineWidth: 0` disables wrapping so long titles/descriptions/URLs stay on
 * one line. The quoting matters for downstream consumers: RSPress parses the
 * emitted frontmatter with js-yaml (YAML 1.1-flavored), where an unquoted
 * ISO timestamp such as `2024-01-15T12:00:00.000Z` decodes to a `Date`
 * object instead of a string. `quoteCompat: "yaml-1.1"` quotes exactly the
 * plain scalars a YAML 1.1 resolver would coerce (timestamps, `yes`/`no`/
 * `on`/`off` booleans, legacy octal/sexagesimal numbers), keeping the
 * decoded representation identical across YAML 1.1 and 1.2 parsers without
 * quoting every value; `quoteStyle: "double"` makes the quotes that do
 * appear double quotes.
 */
const STRINGIFY_OPTIONS = YamlStringifyOptions.make({
	lineWidth: 0,
	quoteCompat: "yaml-1.1",
	quoteStyle: "double",
});

/**
 * Split markdown source into frontmatter data and body content, preserving
 * gray-matter's exact boundary semantics.
 *
 * @remarks
 * This is a byte-for-byte port of the `gray-matter` split contract the
 * snapshot system's hashes depend on (see `@tsdoctor/snapshot`
 * `hashContent`/`hashFrontmatter` and the disk-fallback comparison in
 * `build-stages.ts`), with `@effected/yaml` (`Yaml.parse`, YAML 1.2) as the
 * YAML engine instead of js-yaml:
 *
 * - No opening `---` line at offset 0 → `data: {}` and the whole input as
 *   `content` (a leading BOM is stripped first, as gray-matter does).
 * - The closing delimiter is the first `\n---` after the opening line
 *   (gray-matter uses a plain `indexOf`, so `\n----` also closes and the
 *   leftover `-` stays in the body — preserved deliberately).
 * - Exactly one newline (`\n` or `\r\n`) immediately after the closing `---`
 *   is consumed; everything else is the body verbatim. A build's generated
 *   page (`---\n…\n---\n\n# Title`) therefore yields a body starting with a
 *   single `\n`, exactly as gray-matter returned it.
 * - A block with no closing delimiter is all frontmatter and yields an empty
 *   body; an empty/blank block yields `data: {}`.
 * - Invalid YAML throws (a defect), matching gray-matter's js-yaml throw.
 *
 * One deliberate delta: gray-matter treats text on the opening line
 * (`---toml`) as an engine name and throws for unregistered engines; this
 * split treats such input as "no frontmatter" instead. The plugin never emits
 * or consumes language-tagged frontmatter.
 *
 * `@effected/markdown`'s `FrontmatterSource.split` was evaluated for this
 * path and deliberately NOT adopted: its grammar is strict by design (a
 * fence line is exactly `---`, an unterminated block is not frontmatter),
 * while this contract pins gray-matter's `indexOf`-based quirks (`\n----`
 * closes, trailing-space close lines close, a missing close means
 * all-frontmatter). The emission half (`stringifyFrontmatter` /
 * `emitFrontmatterBlock`) does use `FrontmatterSource.join`.
 *
 * Representation parity with js-yaml is verified by characterization tests
 * (`__test__/frontmatter.test.ts`) pinning hashes captured under gray-matter.
 * The one input where the engines disagree — an *unquoted* ISO timestamp
 * (js-yaml: `Date`, YAML 1.2: string) — is unreachable from this plugin's
 * emitters, which always quote timestamp values, and hashes identically
 * anyway because `hashFrontmatter` JSON-serializes (a `Date` serializes to
 * the same ISO string).
 *
 * @param source - The markdown source, with or without a frontmatter block
 * @returns The decoded frontmatter data and the body content
 *
 * @public
 */
export function parseFrontmatter(source: string): ParsedFrontmatter {
	// The kit's grammar treats offset 0 as the fence position, so a leading BOM
	// would hide the block. Strip it first, as gray-matter did.
	const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;

	const split = FrontmatterSource.split(text);
	if (split.frontmatter === undefined || split.frontmatter.format !== "yaml") {
		return { data: {}, content: split.body };
	}
	if (split.frontmatter.value.trim() === "") {
		return { data: {}, content: split.body };
	}

	// Invalid YAML dies as a defect, as the previous gray-matter-parity split
	// did and as js-yaml's synchronous throw did before that.
	const value = Effect.runSync(Yaml.parse(split.frontmatter.value));
	// A null/empty document maps to {}; any other value (including a scalar
	// document) passes through unchanged.
	const data = value == null ? {} : (value as Record<string, unknown>);
	return { data, content: split.body };
}

/**
 * Serialize frontmatter data and body content back into a markdown document,
 * preserving gray-matter's `matter.stringify` contract.
 *
 * @remarks
 * Emits `---\n<yaml>---\n<content>` with the body's trailing newline ensured,
 * and returns the body unchanged (no fences) when `data` has no keys — both
 * gray-matter behaviors the write path relied on. The YAML is emitted by
 * `@effected/yaml` with every string value double-quoted (see
 * `STRINGIFY_OPTIONS` for why); byte output differs from js-yaml's dump, but
 * the decoded representation is identical, which is the invariant the
 * snapshot hashes depend on. Unchanged pages are never rewritten, so the byte
 * difference only ever lands in files that were being rewritten anyway.
 *
 * @param content - The body content
 * @param data - The frontmatter data to serialize
 * @returns The combined markdown document
 *
 * @public
 */
export function stringifyFrontmatter(content: string, data: Record<string, unknown>): string {
	const body = content.endsWith("\n") ? content : `${content}\n`;
	if (Object.keys(data).length === 0) {
		return body;
	}
	const yaml = Effect.runSync(Yaml.stringify(data, STRINGIFY_OPTIONS));
	return FrontmatterSource.join(
		FrontmatterSourceSplit.make({
			frontmatter: FrontmatterSourceBlock.make({ format: "yaml", value: yaml }),
			body,
		}),
	);
}

/**
 * Serialize a data object to a YAML frontmatter block (fences included, plus
 * the trailing blank line the page generators emit before the body).
 *
 * @remarks
 * Used by `generateFrontmatter` (`markdown/helpers.ts`) as the emission half
 * of the page generators' frontmatter. Every string value is double-quoted
 * (see `STRINGIFY_OPTIONS`), so values that a YAML 1.1 consumer would
 * otherwise coerce (timestamps, `yes`/`no`, numeric-looking strings) stay
 * strings for RSPress's js-yaml parse.
 *
 * @param data - The frontmatter data to serialize
 * @returns A `---`-fenced YAML block ending with a blank line
 *
 * @public
 */
export function emitFrontmatterBlock(data: Record<string, unknown>): string {
	const yaml = Effect.runSync(Yaml.stringify(data, STRINGIFY_OPTIONS));
	return FrontmatterSource.join(
		FrontmatterSourceSplit.make({
			frontmatter: FrontmatterSourceBlock.make({ format: "yaml", value: yaml }),
			body: "\n",
		}),
	);
}
