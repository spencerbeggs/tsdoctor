import type { ApiClass, ApiDeclaredItem, ApiItem } from "@microsoft/api-extractor-model";
import { ApiItems, Routes, Signature, Tsdoc, TypeReferenceExtractor } from "@tsdoctor/model";
import type { LlmsPlugin, SourceConfig } from "../../schemas/config.js";
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
 * Grouped class members by type for organized documentation rendering.
 */
interface GroupedMembers {
	staticMethods: ApiItem[];
	instanceMethods: ApiItem[];
	getters: ApiItem[];
}

/**
 * Generates MDX documentation pages for TypeScript/JavaScript classes.
 *
 * This class transforms API Extractor class models into rich MDX documentation pages
 * with syntax-highlighted signatures, cross-linked type references, and interactive
 * features like copy-to-clipboard and line wrapping.
 *
 * **Page Structure:**
 * 1. Frontmatter with title, description, and Open Graph metadata
 * 2. Component imports (SourceCode, ParametersTable, ApiSignature, etc.)
 * 3. Page title (H1) and summary
 * 4. Optional deprecation warning and release tag badge
 * 5. Source code link toolbar
 * 6. Full class signature block showing all members
 * 7. Member sections: Constructors, Static Properties, Static Methods, Properties, Getters/Setters, Methods
 * 8. Examples section with Twoslash-enabled code blocks
 * 9. See Also references
 *
 * **Member Rendering:**
 * Each member is rendered with:
 * - An `ApiMember` component showing the signature in class context
 * - Optional `ParametersTable` for methods with parameters
 * - Return type documentation
 * - Cross-linked type references
 *
 * **Relationships:**
 * - Created and invoked by {@link ApiExtractorPlugin} during page generation
 * - Uses `Signature.format` from `@tsdoctor/model` for formatting type signatures
 * - Uses the `Tsdoc` / `ApiItems` modules from `@tsdoctor/model` for extracting documentation
 * - Uses the per-build prose linker (`linkProse`) for adding type reference links
 *
 * @example
 * ```ts
 * const generator = new ClassPageGenerator();
 * const { routePath, content } = await generator.generate(
 *   apiClass,
 *   "/api/my-package",
 *   "my-package",
 *   "Class",
 *   "My Package",
 *   sourceConfig,
 *   true, // suppressExampleErrors
 *   undefined, // llmsPlugin
 *   "claude-binary-plugin", // apiScope
 * );
 * ```
 *
 * @see {@link InterfacePageGenerator} for interface documentation
 * @see {@link FunctionPageGenerator} for function documentation
 */
export class ClassPageGenerator {
	/**
	 * Generate a markdown page for a class
	 *
	 * @param apiScope - API scope identifier for VFS lookup
	 */
	public async generate(
		apiClass: ApiClass,
		baseRoute: string,
		packageName: string,
		singularName: string,
		apiScope: string,
		apiName?: string,
		sourceConfig?: SourceConfig,
		suppressExampleErrors?: boolean,
		llmsPlugin?: LlmsPlugin,
		availableFrom?: string[],
		syntheticBase?: ApiItem,
		memberAnchors?: ReadonlyMap<string, string>,
	): Promise<{ routePath: string; content: string }> {
		const shouldSuppressErrors = suppressExampleErrors ?? true;
		const name = apiClass.displayName;
		const summary = Tsdoc.summary(apiClass) || "No description available.";
		const releaseTag = Tsdoc.releaseTag(apiClass);

		let content = generateFrontmatter(name, summary, singularName, apiName);
		content += `import { SourceCode } from "@rspress/core/theme";\n`;
		content += `import { ParametersTable } from "rspress-plugin-api-extractor/runtime";\n`;
		content += `import { ApiSignature, ApiMember, ApiExample } from "rspress-plugin-api-extractor/runtime";\n\n`;

		content += `# ${name}\n\n`;

		// Add deprecation warning if present
		const deprecation = Tsdoc.deprecation(apiClass);
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
		const sourceLink = ApiItems.sourceLink(apiClass, sourceConfig);
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

		// Add full class skeleton as signature using wrapper component
		const skeleton = this.generateClassSkeletonWithTwoslash(apiClass, packageName);

		const displayCode = stripTwoslashDirectives(skeleton);
		// Output heading as markdown for proper spacing (JSX whitespace is ignored in SSG-MD)
		content += `<ApiSignature code={${JSON.stringify(displayCode)}} source={${JSON.stringify(skeleton)}} apiScope={${JSON.stringify(apiScope)}} />\n\n`;

		// Inheritance is now shown in the signature, no need for separate section

		// Synthetic base (e.g. `Foo_base` from Schema.Class patterns): inline the
		// unexported base declaration instead of linking to a standalone page.
		content += this.generateBaseClassSection(apiClass, syntheticBase, packageName, apiScope);

		// 1. Constructors
		const constructors = apiClass.members.filter((m) => m.kind === "Constructor");
		if (constructors.length > 0) {
			content += `## Constructors\n\n`;
			for (const ctor of constructors) {
				const ctorSummary = Tsdoc.summary(ctor);
				const ctorId = Routes.memberAnchor("constructor");
				const ctorItem = ctor as ApiDeclaredItem;
				const params = Tsdoc.params(ctor);
				const hasParameters = params.length > 0;

				if (ctorItem.excerpt?.text) {
					const memberSignature = Signature.format(ctorItem.excerpt).trim();
					const skeletonWithContext = this.generateClassMemberWithContext(apiClass, ctor, packageName);
					const summaryMd = ctorSummary ? escapeMdxGenerics(linkProse(ctorSummary)) : undefined;
					content += `<ApiMember code={${JSON.stringify(memberSignature)}} source={${JSON.stringify(skeletonWithContext)}} apiScope={${JSON.stringify(apiScope)}} memberName="constructor"${summaryMd ? ` summary={${JSON.stringify(summaryMd)}}` : ""} id={${JSON.stringify(ctorId)}} hasParameters={${hasParameters}} />\n\n`;
				}
				if (hasParameters) {
					content += `<ParametersTable parameters={${JSON.stringify(
						params.map((p) => ({
							name: p.name,
							type: p.type,
							description: linkProse(p.description),
						})),
					)}} />\n\n`;
				}
			}
		}

		// Prepare properties and methods for grouped rendering
		const properties = apiClass.members.filter((m) => m.kind === "Property" || m.kind === "PropertySignature");
		const methods = apiClass.members.filter((m) => m.kind === "Method" || m.kind === "MethodSignature");
		const grouped =
			methods.length > 0 ? this.groupClassMembers(methods) : { staticMethods: [], instanceMethods: [], getters: [] };

		// Detect naming conflicts to determine ID prefixes
		const staticProperties = properties.filter((m) => {
			// biome-ignore lint/suspicious/noExplicitAny: API Extractor types require dynamic property access
			return (m as any).isStatic === true;
		});
		const instanceProperties = properties.filter((m) => {
			// biome-ignore lint/suspicious/noExplicitAny: API Extractor types require dynamic property access
			const isStatic = (m as any).isStatic === true;
			const isGetter = m.displayName.startsWith("get ") || m.displayName.startsWith("set ");
			return !isStatic && !isGetter;
		});

		// Anchor ids come from prepareWorkItems, which computed them once for BOTH
		// the cross-link route map and this page. When a caller renders a class
		// outside the pipeline the fallback recomputes them with the SAME
		// function rather than a bare sanitize — a bare sanitize would emit one
		// id for both halves of a static/instance collision, which is the
		// duplicate-id defect Task 1.1 removed.
		const anchors = memberAnchors ?? ApiItems.memberAnchors(apiClass);
		const anchorFor = (member: ApiItem): string =>
			anchors.get(member.canonicalReference?.toString() ?? member.displayName) ??
			Routes.memberAnchor(member.displayName);

		// Helper to render properties
		const renderProperties = async (title: string, propList: typeof properties): Promise<void> => {
			if (propList.length === 0) return;

			content += `## ${title}\n\n`;
			for (const prop of propList) {
				const propSummary = Tsdoc.summary(prop);
				const propId = anchorFor(prop);
				const propItem = prop as ApiDeclaredItem;
				if (propItem.excerpt?.text) {
					const memberSignature = Signature.format(propItem.excerpt).trim();
					const skeletonWithContext = this.generateClassMemberWithContext(apiClass, prop, packageName);
					const summaryMd = propSummary ? escapeMdxGenerics(linkProse(propSummary)) : undefined;
					content += `<ApiMember code={${JSON.stringify(memberSignature)}} source={${JSON.stringify(skeletonWithContext)}} apiScope={${JSON.stringify(apiScope)}} memberName={${JSON.stringify(prop.displayName)}}${summaryMd ? ` summary={${JSON.stringify(summaryMd)}}` : ""} id={${JSON.stringify(propId)}} />\n\n`;
				}
			}
		};

		// Helper to render methods
		const renderMethods = async (title: string, methodList: typeof methods): Promise<void> => {
			if (methodList.length === 0) return;

			content += `## ${title}\n\n`;
			for (const method of methodList) {
				const methodSummary = Tsdoc.summary(method);
				const methodId = anchorFor(method);
				const methodItem = method as ApiDeclaredItem;
				const params = Tsdoc.params(method);
				const hasParameters = params.length > 0;

				if (methodItem.excerpt?.text) {
					const memberSignature = Signature.format(methodItem.excerpt).trim();
					const skeletonWithContext = this.generateClassMemberWithContext(apiClass, method, packageName);
					const summaryMd = methodSummary ? escapeMdxGenerics(linkProse(methodSummary)) : undefined;
					content += `<ApiMember code={${JSON.stringify(memberSignature)}} source={${JSON.stringify(skeletonWithContext)}} apiScope={${JSON.stringify(apiScope)}} memberName={${JSON.stringify(method.displayName)}}${summaryMd ? ` summary={${JSON.stringify(summaryMd)}}` : ""} id={${JSON.stringify(methodId)}} hasParameters={${hasParameters}} />\n\n`;
				}
				if (hasParameters) {
					content += `<ParametersTable parameters={${JSON.stringify(
						params.map((p) => ({
							name: p.name,
							type: p.type,
							description: linkProse(p.description),
						})),
					)}} />\n\n`;
				}
				const returns = Tsdoc.returns(method);
				if (returns) {
					const description = escapeMdxGenerics(linkProse(returns.description));
					content += `**Returns:** ${description}\n\n`;
				}
			}
		};

		// 2. Static Properties
		await renderProperties("Static Properties", staticProperties);

		// 3. Static Methods
		await renderMethods("Static Methods", grouped.staticMethods);

		// 4. Instance Properties
		await renderProperties("Properties", instanceProperties);

		// 5. Getters & Setters
		await renderMethods("Getters & Setters", grouped.getters);

		// 6. Instance Methods
		await renderMethods("Methods", grouped.instanceMethods);

		// Add examples - pre-render with Shiki and Twoslash for better build performance
		const examples = Tsdoc.examples(apiClass);
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
		const seeReferences = Tsdoc.seeReferences(apiClass);
		if (seeReferences.length > 0) {
			content += `## See Also\n\n`;
			for (const reference of seeReferences) {
				const refText = escapeMdxGenerics(linkProse(reference.text));
				content += `- ${refText}\n`;
			}
			content += `\n`;
		}

		return {
			routePath: `${baseRoute}/class/${name.toLowerCase()}`,
			content,
		};
	}

	/**
	 * Render the inline "Base Class" section for a synthetic base declaration
	 * (an unexported item referenced by the class's extends clause, e.g. the
	 * `Foo_base` variable TypeScript emits for `Schema.Class`-style patterns).
	 *
	 * The `## Base Class` heading slugs to `BASE_CLASS_ANCHOR` from
	 * `@tsdoctor/model`'s `SyntheticBases`, which is where the cross-link
	 * route for the base name points.
	 */
	private generateBaseClassSection(
		apiClass: ApiClass,
		syntheticBase: ApiItem | undefined,
		packageName: string,
		apiScope: string,
	): string {
		const baseDecl = syntheticBase as ApiDeclaredItem | undefined;
		if (!baseDecl?.excerpt?.text) {
			return "";
		}

		let section = `## Base Class\n\n`;
		section += `\`${apiClass.displayName}\` extends \`${baseDecl.displayName}\`, a compiler-generated declaration that is not exported from \`${packageName}\`.\n\n`;

		const signature = Signature.format(baseDecl.excerpt).trim();
		let source = signature;
		const apiPackage = apiClass.getAssociatedPackage?.();
		if (apiPackage) {
			const extractor = new TypeReferenceExtractor(apiPackage, packageName);
			const imports = extractor.extractImportsForApiItem(baseDecl);
			source = prependHiddenImports(signature, imports);
		}
		const displayCode = stripTwoslashDirectives(source);
		section += `<ApiSignature code={${JSON.stringify(displayCode)}} source={${JSON.stringify(source)}} apiScope={${JSON.stringify(apiScope)}} />\n\n`;

		return section;
	}

	/**
	 * Group class members by their type (static, instance, getters/setters)
	 */
	private groupClassMembers(members: readonly ApiItem[]): GroupedMembers {
		const staticMethods: ApiItem[] = [];
		const instanceMethods: ApiItem[] = [];
		const getters: ApiItem[] = [];

		for (const member of members) {
			// Check if it's a getter/setter based on the display name pattern
			const isGetter =
				member.kind === "Method" && (member.displayName.startsWith("get ") || member.displayName.startsWith("set "));

			// biome-ignore lint/suspicious/noExplicitAny: API Extractor types require dynamic property access
			const isStatic = (member as any).isStatic === true;

			if (isGetter) {
				getters.push(member);
			} else if (isStatic) {
				staticMethods.push(member);
			} else {
				instanceMethods.push(member);
			}
		}

		return { staticMethods, instanceMethods, getters };
	}

	/**
	 * Generate a class member signature with full class context
	 * Includes hidden imports with cut directive for external type resolution
	 * Uses the simplified approach: 3 lines (class opening, member, closing)
	 */
	private generateClassMemberWithContext(apiClass: ApiClass, targetMember: ApiItem, packageName: string): string {
		const className = apiClass.displayName;

		// Build class declaration
		const inheritance = ApiItems.inheritance(apiClass);
		let declaration = `class ${className}`;
		if (inheritance.extends && inheritance.extends.length > 0) {
			declaration += ` extends ${inheritance.extends.join(", ")}`;
		}
		if (inheritance.implements && inheritance.implements.length > 0) {
			declaration += ` implements ${inheritance.implements.join(", ")}`;
		}
		declaration += " {";

		// Get the target member signature
		const memberItem = targetMember as ApiDeclaredItem;
		const memberSignature = memberItem.excerpt?.text ? Signature.format(memberItem.excerpt).trim() : "";

		// Build the simplified structure: class opening, target member, closing
		// The hide-cut transformer will hide the first and third lines
		const skeleton = `${declaration}\n${memberSignature}\n}`;

		// Extract imports for external type references in this member
		const apiPackage = apiClass.getAssociatedPackage?.();
		if (apiPackage) {
			const extractor = new TypeReferenceExtractor(apiPackage, packageName);
			const imports = extractor.extractImportsForApiItem(targetMember);
			return prependHiddenImports(skeleton, imports);
		}

		return skeleton;
	}

	/**
	 * Generate a class skeleton for signature blocks
	 * Includes hidden imports with cut directive for external type resolution
	 */
	private generateClassSkeletonWithTwoslash(apiClass: ApiClass, packageName: string): string {
		const skeleton = this.generateClassSkeleton(apiClass);

		// Extract imports for external type references in the entire class
		const apiPackage = apiClass.getAssociatedPackage?.();
		if (apiPackage) {
			const extractor = new TypeReferenceExtractor(apiPackage, packageName);
			const imports = extractor.extractImportsForApiItem(apiClass);
			return prependHiddenImports(skeleton, imports);
		}

		return skeleton;
	}

	/**
	 * Generate a complete class skeleton showing all members
	 */
	private generateClassSkeleton(apiClass: ApiClass): string {
		const lines: string[] = [];
		const className = apiClass.displayName;

		// Class declaration with extends/implements clauses
		const inheritance = ApiItems.inheritance(apiClass);
		let declaration = `class ${className}`;
		if (inheritance.extends && inheritance.extends.length > 0) {
			declaration += ` extends ${inheritance.extends.join(", ")}`;
		}
		if (inheritance.implements && inheritance.implements.length > 0) {
			declaration += ` implements ${inheritance.implements.join(", ")}`;
		}
		declaration += " {";
		lines.push(declaration);

		// 1. Constructors FIRST
		const constructors = apiClass.members.filter((m) => m.kind === "Constructor");
		if (constructors.length > 0) {
			for (const ctor of constructors) {
				const ctorItem = ctor as ApiDeclaredItem;
				if (ctorItem.excerpt?.text) {
					const signature = Signature.format(ctorItem.excerpt).trim();
					lines.push(`    ${signature}`);
				}
			}
		}

		// 2. Static members (properties and methods)
		const methods = apiClass.members.filter((m) => m.kind === "Method" || m.kind === "MethodSignature");
		const grouped = this.groupClassMembers(methods);

		// Static properties
		const properties = apiClass.members.filter((m) => m.kind === "Property" || m.kind === "PropertySignature");
		const staticProperties = properties.filter((m) => {
			// biome-ignore lint/suspicious/noExplicitAny: API Extractor types require dynamic property access
			return (m as any).isStatic === true;
		});
		if (staticProperties.length > 0) {
			for (const prop of staticProperties) {
				const propItem = prop as ApiDeclaredItem;
				if (propItem.excerpt?.text) {
					const signature = Signature.format(propItem.excerpt).trim();
					lines.push(`    ${signature}`);
				}
			}
		}

		// Static methods
		if (grouped.staticMethods.length > 0) {
			for (const method of grouped.staticMethods) {
				const methodItem = method as ApiDeclaredItem;
				if (methodItem.excerpt?.text) {
					const signature = Signature.format(methodItem.excerpt).trim();
					lines.push(`    ${signature}`);
				}
			}
		}

		// 3. Instance properties (non-static, non-getters)
		const instanceProperties = properties.filter((m) => {
			// biome-ignore lint/suspicious/noExplicitAny: API Extractor types require dynamic property access
			const isStatic = (m as any).isStatic === true;
			const isGetter = m.displayName.startsWith("get ") || m.displayName.startsWith("set ");
			return !isStatic && !isGetter;
		});
		if (instanceProperties.length > 0) {
			for (const prop of instanceProperties) {
				const propItem = prop as ApiDeclaredItem;
				if (propItem.excerpt?.text) {
					const signature = Signature.format(propItem.excerpt).trim();
					lines.push(`    ${signature}`);
				}
			}
		}

		// 4. Getters and setters
		if (grouped.getters.length > 0) {
			for (const method of grouped.getters) {
				const methodItem = method as ApiDeclaredItem;
				if (methodItem.excerpt?.text) {
					const signature = Signature.format(methodItem.excerpt).trim();
					lines.push(`    ${signature}`);
				}
			}
		}

		// 5. Instance methods
		if (grouped.instanceMethods.length > 0) {
			for (const method of grouped.instanceMethods) {
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
