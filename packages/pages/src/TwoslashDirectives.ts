/**
 * Twoslash directive detection — the regexes that decide which lines of a
 * code block are notation rather than code.
 *
 * @remarks
 * These mirror the upstream Twoslash source
 * (`twoslashes/twoslash`, `packages/twoslash/src/regexp.ts`). All patterns
 * allow an optional space after `//`, so both `// @noErrors` and `//@noErrors`
 * are recognized, as Twoslash itself does. They live in the IR package
 * because the display/source split depends on them and both adapters must
 * strip the same lines.
 *
 * @packageDocumentation
 */

/**
 * Config directives: boolean flags and key-value pairs.
 *
 * Upstream: `reConfigBoolean` + `reConfigValue` + `reFilenamesMakers` —
 * `// @noErrors`, `//@strict`, `// @errors: 2304`, `// @filename: example.ts`.
 */
const RE_CONFIG = /^\/\/\s?@\w+/;

/**
 * Annotation markers: query, completion, and highlight markers.
 *
 * Upstream: `reAnnonateMarkers` — `/^\s*\/\/\s*\^(\?|\||\^+)( .*)?$/gm`. After
 * `line.trim()` leading whitespace is gone but the spaces between `//` and
 * `^` are preserved, so `//    ^?` still matches.
 */
const RE_ANNOTATION = /^\/\/\s*\^[?|^]/;

/**
 * Cut directives: `// ---cut---`, `//---cut-before---`, `// ---cut-after---`,
 * `// ---cut-start---`, `// ---cut-end---`.
 */
const RE_CUT = /^\/\/\s?---cut/;

/**
 * The four cut directive forms.
 *
 * @public
 */
export type CutDirective = "cut-before" | "cut-after" | "cut-start" | "cut-end";

/**
 * Test whether a trimmed line is any Twoslash directive — a config flag or
 * value, a filename marker, an annotation marker or a cut directive.
 *
 * @param trimmedLine - The line with leading and trailing whitespace removed
 * @returns `true` if the line is a Twoslash directive
 * @public
 */
export function isTwoslashDirective(trimmedLine: string): boolean {
	return RE_CONFIG.test(trimmedLine) || RE_ANNOTATION.test(trimmedLine) || RE_CUT.test(trimmedLine);
}

/**
 * Classify a cut directive line.
 *
 * @param trimmedLine - The line with leading and trailing whitespace removed
 * @returns The cut form, or `null` if the line is not a cut directive
 * @public
 */
export function classifyCutDirective(trimmedLine: string): CutDirective | null {
	if (/^\/\/\s?---cut(-before)?---$/.test(trimmedLine)) return "cut-before";
	if (/^\/\/\s?---cut-after---$/.test(trimmedLine)) return "cut-after";
	if (/^\/\/\s?---cut-start---$/.test(trimmedLine)) return "cut-start";
	if (/^\/\/\s?---cut-end---$/.test(trimmedLine)) return "cut-end";
	return null;
}
