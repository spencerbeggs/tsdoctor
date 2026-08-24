/**
 * Prose-to-node helpers shared by the Render module. Prose strings arriving
 * here may already carry markdown syntax (backtick code spans from TSDoc
 * extraction, `[Name](route)` links injected by the CrossLinker), so they are
 * parsed back into phrasing nodes rather than wrapped in Text nodes — a Text
 * node would have its brackets and backticks escaped by the canonical
 * serializer.
 *
 * @internal
 */

import type { PhrasingContent } from "@effected/markdown";
import { Markdown, Paragraph, Text } from "@effected/markdown";
import { Result } from "effect";

/**
 * Parse a single-line markdown prose string into phrasing nodes. Multiple
 * paragraphs collapse into one phrasing run (prose from TSDoc extraction is
 * whitespace-normalized single-line text). Falls back to a literal Text node
 * when the string does not parse.
 */
export const phrasingFromMarkdown = (prose: string): ReadonlyArray<PhrasingContent> => {
	const parsed = Markdown.parseResult(prose);
	if (Result.isFailure(parsed)) {
		return [new Text({ value: prose })];
	}
	const phrasing: PhrasingContent[] = [];
	for (const child of parsed.success.children) {
		if (child instanceof Paragraph) {
			phrasing.push(...child.children);
		}
	}
	return phrasing.length > 0 ? phrasing : [new Text({ value: prose })];
};
