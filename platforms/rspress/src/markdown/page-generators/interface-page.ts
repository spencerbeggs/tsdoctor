import type { ApiDeclaredItem, ApiInterface, ApiItem } from "@microsoft/api-extractor-model";
import { ApiItems, Routes, Signature, Tsdoc } from "@tsdoctor/model";
import type { LlmsPlugin, SourceConfig } from "../../schemas/config.js";
import { TypeReferenceExtractor } from "../../type-reference-extractor.js";
import {
	escapeMdxGenerics,
	formatExampleCode,
	generateAvailableFrom,
	generateFrontmatter,
	prepareExampleCode,
	prependHiddenImports,
	stripTwoslashDirectives,
} from "../helpers.js";
import { linkProse } from "../prose-linker.js";

/**
 * Generates MDX documentation pages for TypeScript interfaces.
 *
 * This class transforms API Extractor interface models into rich MDX documentation
 * pages with syntax-highlighted signatures, cross-linked type references, and
 * interactive features.
 *
 * **Page Structure:**
 * 1. Frontmatter with title, description, and Open Graph metadata
 * 2. Component imports (SourceCode, ParametersTable, ApiSignature, etc.)
 * 3. Page title (H1) and summary
 * 4. Optional deprecation warning and release tag badge
 * 5. Source code link toolbar
 * 6. Full interface signature block showing all members
 * 7. Member sections: Call Signatures, Construct Signatures, Index Signatures, Properties, Methods
 * 8. Examples section with Twoslash-enabled code blocks
 * 9. See Also references
 *
 * **Interface-Specific Features:**
 * - Handles type parameters (generics) in interface declarations
 * - Supports call signatures for callable interfaces
 * - Supports construct signatures for constructable interfaces
 * - Supports index signatures for dictionary-like interfaces
 * - Handles extends clauses for interface inheritance
 *
 * **Relationships:**
 * - Created and invoked by {@link ApiExtractorPlugin} during page generation
 * - Uses `Signature.format` from `@tsdoctor/model` for formatting type signatures
 * - Uses the `Tsdoc` / `ApiItems` modules from `@tsdoctor/model` for extracting documentation
 * - Uses the per-build prose linker (`linkProse`) for adding type reference links
 *
 * @example
 * ```ts
 * const generator = new InterfacePageGenerator();
 * const { routePath, content } = await generator.generate(
 *   apiInterface,
 *   "/api/my-package",
 *   "my-package",
 *   "Interface",
 *   "My Package",
 *   sourceConfig,
 *   true, // suppressExampleErrors
 *   undefined, // llmsPlugin
 *   "claude-binary-plugin", // apiScope
 * );
 * ```
 *
 * @see {@link ClassPageGenerator} for class documentation
 * @see {@link TypeAliasPageGenerator} for type alias documentation
 */
export class InterfacePageGenerator {
	/**
	 * Generate a markdown page for an interface
	 *
	 * @param apiScope - API scope identifier for VFS lookup
	 */
	public async generate(
		apiInterface: ApiInterface,
		baseRoute: string,
		packageName: string,
		singularName: string,
		apiScope: string,
		apiName?: string,
		sourceConfig?: SourceConfig,
		suppressExampleErrors?: boolean,
		llmsPlugin?: LlmsPlugin,
		availableFrom?: string[],
	): Promise<{ routePath: string; content: string }> {
		const shouldSuppressErrors = suppressExampleErrors ?? true;
		const name = apiInterface.displayName;
		const summary = Tsdoc.summary(apiInterface) || "No description available.";
		const releaseTag = Tsdoc.releaseTag(apiInterface);

		let content = generateFrontmatter(name, summary, singularName, apiName);
		content += `import { SourceCode } from "@rspress/core/theme";\n`;
		content += `import { ParametersTable } from "rspress-plugin-api-extractor/runtime";\n`;
		content += `import { ApiSignature, ApiMember, ApiExample } from "rspress-plugin-api-extractor/runtime";\n\n`;

		content += `# ${name}\n\n`;

		// Add deprecation warning if present
		const deprecation = Tsdoc.deprecation(apiInterface);
		if (deprecation) {
			const message = escapeMdxGenerics(linkProse(deprecation.message));
			content += `> ⚠️ **Deprecated:** ${message}\n\n`;
		}

		// Add release tag badge
		if (releaseTag !== "Public") {
			content += `\`${releaseTag}\`\n\n`;
		}

		// Add summary
		content += `${summary}\n\n`;

		// Add "Available from" for multi-entry items
		content += generateAvailableFrom(packageName, availableFrom);

		// Add toolbar with source code badge
		const sourceLink = ApiItems.sourceLink(apiInterface, sourceConfig);
		if (sourceLink) {
			content += `<div className="api-docs-toolbar">\n`;
			content += `  <div className="api-docs-toolbar-left">\n`;
			content += `    <SourceCode href="${sourceLink}" />\n`;
			content += `  </div>\n`;
			if (llmsPlugin?.enabled) {
				content += `  <div className="api-docs-toolbar-right">\n`;
				// TODO: Re-enable after fixing SSG rendering issues
				// content += `    <ApiDocsLlmsTools showCopyButton={${llmsPlugin.showCopyButton}} showViewOptions={${llmsPlugin.showViewOptions}} copyButtonText={${JSON.stringify(llmsPlugin.copyButtonText)}} viewOptions={${JSON.stringify(llmsPlugin.viewOptions)}} />\n`;
				content += `  </div>\n`;
			}
			content += `</div>\n\n`;
		}

		// Add full interface skeleton as signature with Shiki HAST
		const skeleton = this.generateInterfaceSkeletonWithTwoslash(apiInterface, packageName);

		const displayCode = stripTwoslashDirectives(skeleton);
		content += `<ApiSignature code={${JSON.stringify(displayCode)}} source={${JSON.stringify(skeleton)}} apiScope={${JSON.stringify(apiScope)}} />\n\n`;

		// Inheritance is now shown in the signature, no need for separate section

		// List call signatures
		const callSignatures = apiInterface.members.filter((m) => m.kind === "CallSignature");
		if (callSignatures.length > 0) {
			content += `## Call Signatures\n\n`;
			for (const callSig of callSignatures) {
				const callSigSummary = Tsdoc.summary(callSig);
				const callSigId = Routes.memberAnchor("call-signature");
				// Add call signature if available
				const callSigItem = callSig as ApiDeclaredItem;
				if (callSigItem.excerpt?.text) {
					const memberSignature = Signature.format(callSigItem.excerpt).trim();
					const skeletonWithContext = this.generateInterfaceMemberWithContext(apiInterface, callSig, packageName);
					const summaryMd = callSigSummary ? escapeMdxGenerics(linkProse(callSigSummary)) : undefined;
					content += `<ApiMember code={${JSON.stringify(memberSignature)}} source={${JSON.stringify(skeletonWithContext)}} apiScope={${JSON.stringify(apiScope)}} memberName="Call Signature"${summaryMd ? ` summary={${JSON.stringify(summaryMd)}}` : ""} id={${JSON.stringify(callSigId)}} />\n\n`;
				}
			}
		}

		// List construct signatures
		const constructSignatures = apiInterface.members.filter((m) => m.kind === "ConstructSignature");
		if (constructSignatures.length > 0) {
			content += `## Construct Signatures\n\n`;
			for (const constructSig of constructSignatures) {
				const constructSigSummary = Tsdoc.summary(constructSig);
				const constructSigId = Routes.memberAnchor("construct-signature");
				// Add construct signature if available
				const constructSigItem = constructSig as ApiDeclaredItem;
				if (constructSigItem.excerpt?.text) {
					const memberSignature = Signature.format(constructSigItem.excerpt).trim();
					const skeletonWithContext = this.generateInterfaceMemberWithContext(apiInterface, constructSig, packageName);
					const summaryMd = constructSigSummary ? escapeMdxGenerics(linkProse(constructSigSummary)) : undefined;
					content += `<ApiMember code={${JSON.stringify(memberSignature)}} source={${JSON.stringify(skeletonWithContext)}} apiScope={${JSON.stringify(apiScope)}} memberName="Construct Signature"${summaryMd ? ` summary={${JSON.stringify(summaryMd)}}` : ""} id={${JSON.stringify(constructSigId)}} />\n\n`;
				}
			}
		}

		// List index signatures
		const indexSignatures = apiInterface.members.filter((m) => m.kind === "IndexSignature");
		if (indexSignatures.length > 0) {
			content += `## Index Signature\n\n`;
			for (const indexSig of indexSignatures) {
				const indexSigSummary = Tsdoc.summary(indexSig);
				const indexSigId = Routes.memberAnchor("index-signature");
				// Add index signature if available
				const indexSigItem = indexSig as ApiDeclaredItem;
				if (indexSigItem.excerpt?.text) {
					const memberSignature = Signature.format(indexSigItem.excerpt).trim();
					const skeletonWithContext = this.generateInterfaceMemberWithContext(apiInterface, indexSig, packageName);
					const summaryMd = indexSigSummary ? escapeMdxGenerics(linkProse(indexSigSummary)) : undefined;
					content += `<ApiMember code={${JSON.stringify(memberSignature)}} source={${JSON.stringify(skeletonWithContext)}} apiScope={${JSON.stringify(apiScope)}} memberName="Index Signature"${summaryMd ? ` summary={${JSON.stringify(summaryMd)}}` : ""} id={${JSON.stringify(indexSigId)}} />\n\n`;
				}
			}
		}

		// List properties
		const properties = apiInterface.members.filter((m) => m.kind === "PropertySignature");
		if (properties.length > 0) {
			content += `## Properties\n\n`;
			for (const prop of properties) {
				const propSummary = Tsdoc.summary(prop);
				const propId = Routes.memberAnchor(prop.displayName);
				// Add property signature if available
				const propItem = prop as ApiDeclaredItem;
				if (propItem.excerpt?.text) {
					const memberSignature = Signature.format(propItem.excerpt).trim();
					const skeletonWithContext = this.generateInterfaceMemberWithContext(apiInterface, prop, packageName);
					const summaryMd = propSummary ? escapeMdxGenerics(linkProse(propSummary)) : undefined;
					content += `<ApiMember code={${JSON.stringify(memberSignature)}} source={${JSON.stringify(skeletonWithContext)}} apiScope={${JSON.stringify(apiScope)}} memberName={${JSON.stringify(prop.displayName)}}${summaryMd ? ` summary={${JSON.stringify(summaryMd)}}` : ""} id={${JSON.stringify(propId)}} />\n\n`;
				}
			}
		}

		// List methods
		const methods = apiInterface.members.filter((m) => m.kind === "MethodSignature");
		if (methods.length > 0) {
			content += `## Methods\n\n`;
			for (const method of methods) {
				const methodSummary = Tsdoc.summary(method);
				const methodId = Routes.memberAnchor(method.displayName);
				// Add method signature if available
				const methodItem = method as ApiDeclaredItem;
				if (methodItem.excerpt?.text) {
					const memberSignature = Signature.format(methodItem.excerpt).trim();
					const skeletonWithContext = this.generateInterfaceMemberWithContext(apiInterface, method, packageName);
					const params = Tsdoc.params(method);
					const hasParameters = params.length > 0;
					const summaryMd = methodSummary ? escapeMdxGenerics(linkProse(methodSummary)) : undefined;
					content += `<ApiMember code={${JSON.stringify(memberSignature)}} source={${JSON.stringify(skeletonWithContext)}} apiScope={${JSON.stringify(apiScope)}} memberName={${JSON.stringify(method.displayName)}}${summaryMd ? ` summary={${JSON.stringify(summaryMd)}}` : ""} id={${JSON.stringify(methodId)}} hasParameters={${hasParameters}} />\n\n`;
				}
				// Add parameters documentation
				const params = Tsdoc.params(method);
				if (params.length > 0) {
					content += `<ParametersTable parameters={${JSON.stringify(
						params.map((p) => ({
							name: p.name,
							type: p.type,
							description: linkProse(p.description),
						})),
					)}} />\n\n`;
				}
				// Add returns documentation
				const returns = Tsdoc.returns(method);
				if (returns) {
					const description = escapeMdxGenerics(linkProse(returns.description));
					content += `**Returns:** ${description}\n\n`;
				}
			}
		}

		// Add examples - pre-render with Shiki and Twoslash for better build performance
		const examples = Tsdoc.examples(apiInterface);
		if (examples.length > 0) {
			content += `## Examples\n\n`;
			for (const example of examples) {
				const prepared = prepareExampleCode(example, name, packageName, shouldSuppressErrors);

				// Format code with Prettier for consistent styling
				const formattedCode = await formatExampleCode(prepared.code, prepared.language, {
					api: packageName,
					blockType: "example",
				});

				if (prepared.isTypeScript) {
					const displayCode = stripTwoslashDirectives(formattedCode);
					content += `<ApiExample code={${JSON.stringify(displayCode)}} source={${JSON.stringify(formattedCode)}} apiScope={${JSON.stringify(apiScope)}} />\n\n`;
				} else {
					// Non-TypeScript examples: output plain code block
					content += `\`\`\`${prepared.language}\n${formattedCode}\n\`\`\`\n\n`;
				}
			}
		}

		// Add see also references
		const seeReferences = Tsdoc.seeReferences(apiInterface);
		if (seeReferences.length > 0) {
			content += `## See Also\n\n`;
			for (const reference of seeReferences) {
				const refText = escapeMdxGenerics(linkProse(reference.text));
				content += `- ${refText}\n`;
			}
			content += `\n`;
		}

		return {
			routePath: `${baseRoute}/interface/${name.toLowerCase()}`,
			content,
		};
	}

	/**
	 * Generate an interface member signature with full interface context
	 * Includes hidden imports with cut directive for external type resolution
	 * Uses the simplified approach: 3 lines (interface opening, member, closing)
	 */
	private generateInterfaceMemberWithContext(
		apiInterface: ApiInterface,
		targetMember: ApiItem,
		packageName: string,
	): string {
		const interfaceName = apiInterface.displayName;

		// Build interface declaration with type parameters
		const inheritance = ApiItems.inheritance(apiInterface);
		let declaration = `interface ${interfaceName}`;

		// Add type parameters if present
		if (apiInterface.typeParameters && apiInterface.typeParameters.length > 0) {
			const typeParams = apiInterface.typeParameters.map((tp) => tp.name).join(", ");
			declaration += `<${typeParams}>`;
		}

		if (inheritance.extends && inheritance.extends.length > 0) {
			declaration += ` extends ${inheritance.extends.join(", ")}`;
		}
		declaration += " {";

		// Get the target member signature
		const memberItem = targetMember as ApiDeclaredItem;
		const memberSignature = memberItem.excerpt?.text ? Signature.format(memberItem.excerpt).trim() : "";

		// Build the simplified structure: interface opening, target member, closing
		// The hide-cut transformer will hide the first and third lines
		const skeleton = `${declaration}\n${memberSignature}\n}`;

		// Extract imports for external type references in this member
		const apiPackage = apiInterface.getAssociatedPackage?.();
		if (apiPackage) {
			const extractor = new TypeReferenceExtractor(apiPackage, packageName);
			const imports = extractor.extractImportsForApiItem(targetMember);
			return prependHiddenImports(skeleton, imports);
		}

		return skeleton;
	}

	/**
	 * Generate an interface skeleton for signature blocks
	 * Includes hidden imports with cut directive for external type resolution
	 */
	private generateInterfaceSkeletonWithTwoslash(apiInterface: ApiInterface, packageName: string): string {
		const skeleton = this.generateInterfaceSkeleton(apiInterface);

		// Extract imports for external type references in the entire interface
		const apiPackage = apiInterface.getAssociatedPackage?.();
		if (apiPackage) {
			const extractor = new TypeReferenceExtractor(apiPackage, packageName);
			const imports = extractor.extractImportsForApiItem(apiInterface);
			return prependHiddenImports(skeleton, imports);
		}

		return skeleton;
	}

	/**
	 * Generate a complete interface skeleton showing all members
	 */
	private generateInterfaceSkeleton(apiInterface: ApiInterface): string {
		const lines: string[] = [];
		const interfaceName = apiInterface.displayName;

		// Interface declaration with type parameters and extends clause
		const inheritance = ApiItems.inheritance(apiInterface);
		let declaration = `interface ${interfaceName}`;

		// Add type parameters if present
		if (apiInterface.typeParameters && apiInterface.typeParameters.length > 0) {
			const typeParams = apiInterface.typeParameters.map((tp) => tp.name).join(", ");
			declaration += `<${typeParams}>`;
		}

		if (inheritance.extends && inheritance.extends.length > 0) {
			declaration += ` extends ${inheritance.extends.join(", ")}`;
		}
		declaration += " {";
		lines.push(declaration);

		// Call signatures (callable interfaces)
		const callSignatures = apiInterface.members.filter((m) => m.kind === "CallSignature");
		if (callSignatures.length > 0) {
			for (const callSig of callSignatures) {
				const callSigItem = callSig as ApiDeclaredItem;
				if (callSigItem.excerpt?.text) {
					const signature = Signature.format(callSigItem.excerpt).trim();
					lines.push(`    ${signature}`);
				}
			}
		}

		// Construct signatures (constructable interfaces)
		const constructSignatures = apiInterface.members.filter((m) => m.kind === "ConstructSignature");
		if (constructSignatures.length > 0) {
			for (const constructSig of constructSignatures) {
				const constructSigItem = constructSig as ApiDeclaredItem;
				if (constructSigItem.excerpt?.text) {
					const signature = Signature.format(constructSigItem.excerpt).trim();
					lines.push(`    ${signature}`);
				}
			}
		}

		// Index signatures
		const indexSignatures = apiInterface.members.filter((m) => m.kind === "IndexSignature");
		if (indexSignatures.length > 0) {
			for (const indexSig of indexSignatures) {
				const indexSigItem = indexSig as ApiDeclaredItem;
				if (indexSigItem.excerpt?.text) {
					const signature = Signature.format(indexSigItem.excerpt).trim();
					lines.push(`    ${signature}`);
				}
			}
		}

		// Properties
		const properties = apiInterface.members.filter((m) => m.kind === "PropertySignature");
		if (properties.length > 0) {
			for (const prop of properties) {
				const propItem = prop as ApiDeclaredItem;
				if (propItem.excerpt?.text) {
					const signature = Signature.format(propItem.excerpt).trim();
					lines.push(`    ${signature}`);
				}
			}
		}

		// Methods
		const methods = apiInterface.members.filter((m) => m.kind === "MethodSignature");
		if (methods.length > 0) {
			for (const method of methods) {
				const methodItem = method as ApiDeclaredItem;
				if (methodItem.excerpt?.text) {
					const signature = Signature.format(methodItem.excerpt).trim();
					lines.push(`    ${signature}`);
				}
			}
		}

		lines.push("}");

		return lines.join("\n");
	}
}
