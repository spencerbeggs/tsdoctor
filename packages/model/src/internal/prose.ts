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
import { Markdown, Text } from "@effected/markdown";
import { Result } from "effect";

/**
 * Parse a single-line markdown prose string into phrasing nodes. The whole
 * input is treated as one paragraph's inline content (prose from TSDoc
 * extraction is whitespace-normalized single-line text). Falls back to a
 * literal Text node when the string does not parse.
 */
export const phrasingFromMarkdown = (prose: string): ReadonlyArray<PhrasingContent> => {
	const parsed = Markdown.parsePhrasingResult(prose);
	if (Result.isFailure(parsed)) {
		return [new Text({ value: prose })];
	}
	return parsed.success.length > 0 ? parsed.success : [new Text({ value: prose })];
};
