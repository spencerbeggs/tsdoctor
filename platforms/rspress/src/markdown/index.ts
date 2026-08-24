/* v8 ignore start -- re-export barrel, no testable logic */
// Cross-linking functionality (per-build holder over @tsdoctor/model's CrossLinker)

// Page generators
export { ClassPageGenerator } from "./page-generators/class-page.js";
export { EnumPageGenerator } from "./page-generators/enum-page.js";
export { FunctionPageGenerator } from "./page-generators/function-page.js";
export { MainIndexPageGenerator } from "./page-generators/index-pages.js";
export { InterfacePageGenerator } from "./page-generators/interface-page.js";
export { NamespacePageGenerator } from "./page-generators/namespace-page.js";
export { TypeAliasPageGenerator } from "./page-generators/type-alias-page.js";
export { VariablePageGenerator } from "./page-generators/variable-page.js";
export { clearProseLinker, linkProse, setProseLinker } from "./prose-linker.js";
