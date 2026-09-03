/**
 * `@tsdoctor/pages` — the framework-neutral documentation page IR for static
 * TypeScript API sites: typed doc blocks lifted from an API Extractor model,
 * one navigation tree per API, display/source code preparation, a plain
 * markdown emitter and the llms.txt text transforms.
 *
 * @packageDocumentation
 */

export type { BlockKind } from "./Blocks.js";
export {
	AvailableFrom,
	BaseClass,
	Block,
	CodeText,
	EnumMemberRow,
	EnumMemberTable,
	Example,
	ExampleGroup,
	Inline,
	Member,
	MemberGroup,
	MemberIndex,
	MemberIndexEntry,
	MemberRole,
	ParameterRow,
	ParameterTable,
	Prose,
	ProseBlock,
	ProseRole,
	ReleaseTag,
	SeeAlso,
	Signature,
	SourceLink,
	Title,
} from "./Blocks.js";
export type { BuildIndexPageInput, BuildPageInput, NamespaceMemberFacts } from "./Build.js";
export { INDEX_PAGE_TITLE, IndexPage, NO_DESCRIPTION, buildIndexPage, buildPage, isPageKind } from "./Build.js";
export type { PreparedExample, RawExample } from "./Examples.js";
export {
	ExampleFormatError,
	addLogicalBlankLines,
	buildExample,
	codeText,
	formatExampleCode,
	prepareExampleCode,
	prependHiddenImports,
	stripTwoslashDirectives,
} from "./Examples.js";
export type { LlmsTxtEntry, PackageLlmsTxtInput, PackagePointer, PackageScopeInfo, PageContent } from "./Llms.js";
export {
	filterLlmsFullTxt,
	filterLlmsTxt,
	generatePackageLlmsFullTxt,
	generatePackageLlmsTxt,
	generateStructuredLlmsTxt,
	parseLlmsTxtLine,
} from "./Llms.js";
export { markdownBlockTree, markdownTree, renderMarkdown, renderMarkdownResult } from "./Markdown.js";
export type { BuildNavInput } from "./Nav.js";
export { NAV_INDEX_LABEL, NavCategory, NavEntry, NavGroup, NavPage, NavTree, buildNav, sortNavPages } from "./Nav.js";
export { type HeadTag, Page, PageKind } from "./Page.js";
export { apiScopeOf, normalizeBaseRoute, unscopedName } from "./Scope.js";
export { type CutDirective, classifyCutDirective, isTwoslashDirective } from "./TwoslashDirectives.js";
export type {
	CrossLinkData,
	PrepareWorkItemsInput,
	PrepareWorkItemsResult,
	WorkItem,
	WorkItemCategory,
} from "./WorkItems.js";
export { crossLinkKindPriority, prepareWorkItems } from "./WorkItems.js";
