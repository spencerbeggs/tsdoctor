import { emitFrontmatterBlock } from "../../frontmatter.js";

/**
 * Generator for main API index page with only frontmatter (no content)
 */
export class MainIndexPageGenerator {
	/**
	 * Generate the main API index page
	 */
	public generate(
		packageName: string,
		baseRoute: string,
		_categoryCounts: Record<string, number>,
	): { routePath: string; content: string } {
		// Emitted through the shared frontmatter writer rather than a template
		// literal. It was the last hand-rolled YAML emitter in the plugin, and
		// its escaper was a partial reimplementation of quoting rules the YAML
		// library already owns — a scoped package name like `@scope/pkg` opens
		// with a YAML indicator character and must be quoted or the document
		// fails to parse.
		//
		// This also fixes a real defect. The old code interpolated
		// `escapeYamlString(packageName)` INTO the description string, so for a
		// scoped package the quotes the escaper added became literal characters
		// in the value: the rendered meta description read
		// `Auto-generated API documentation for "@scope/pkg"`. Passing the whole
		// description to the emitter lets it quote the scalar only when YAML
		// requires it, and the stray quotes are gone.
		//
		// `writeMetadata` skips `index.mdx` when it already exists, so only a
		// fresh site picks this up.
		const content = emitFrontmatterBlock({
			title: "API Reference",
			description: `Auto-generated API documentation for ${packageName}`,
			overview: true,
		});

		return {
			routePath: `${baseRoute}/index`,
			content,
		};
	}
}
