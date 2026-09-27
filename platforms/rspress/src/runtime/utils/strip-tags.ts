/**
 * Remove every `<...>` tag from `text`, keeping the text between tags.
 *
 * A linear scan with the same result as `text.replace(/<[^>]*>/g, "")`: each
 * `<` that has a later `>` is dropped through that `>`, and a `<` with no `>`
 * after it is kept along with the rest of the string. The regex form
 * backtracks quadratically on a long run of unclosed `<`.
 *
 * This is text cleanup for markdown output, not HTML sanitization; the result
 * is rendered as a React text child, which escapes it.
 */
export function stripTags(text: string): string {
	let out = "";
	let i = 0;
	while (i < text.length) {
		const open = text.indexOf("<", i);
		if (open === -1) return out + text.slice(i);
		const close = text.indexOf(">", open + 1);
		if (close === -1) return out + text.slice(i);
		out += text.slice(i, open);
		i = close + 1;
	}
	return out;
}
