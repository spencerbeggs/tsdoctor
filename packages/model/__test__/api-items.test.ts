import type { ApiClass, ApiInterface, ApiItem } from "@microsoft/api-extractor-model";
import { ApiItemKind } from "@microsoft/api-extractor-model";
import { describe, expect, it } from "vitest";

import { ApiItems } from "../src/index.js";
import { loadKitchensink } from "./utils/kitchensink.js";

describe("ApiItems.sourceLink", () => {
	it("constructs a source link with file path and line number", () => {
		const mockItem = { fileUrlPath: "src/index.ts", fileLineNumber: 42 } as unknown as ApiItem;
		const result = ApiItems.sourceLink(mockItem, { url: "https://github.com/owner/repo", ref: "blob/main" });
		expect(result).toBe("https://github.com/owner/repo/blob/main/src/index.ts#L42");
	});

	it("constructs a source link without line number", () => {
		const mockItem = { fileUrlPath: "src/utils.ts" } as unknown as ApiItem;
		const result = ApiItems.sourceLink(mockItem, { url: "https://github.com/owner/repo", ref: "blob/main" });
		expect(result).toBe("https://github.com/owner/repo/blob/main/src/utils.ts");
	});

	it("defaults to blob/main when ref is not specified", () => {
		const mockItem = { fileUrlPath: "src/types.ts" } as unknown as ApiItem;
		const result = ApiItems.sourceLink(mockItem, { url: "https://github.com/owner/repo" });
		expect(result).toBe("https://github.com/owner/repo/blob/main/src/types.ts");
	});

	it("handles custom refs like tags", () => {
		const mockItem = { fileUrlPath: "src/api.ts", fileLineNumber: 10 } as unknown as ApiItem;
		const result = ApiItems.sourceLink(mockItem, { url: "https://github.com/owner/repo", ref: "blob/v1.0.0" });
		expect(result).toBe("https://github.com/owner/repo/blob/v1.0.0/src/api.ts#L10");
	});

	it("returns null when no target is given", () => {
		const mockItem = { fileUrlPath: "src/index.ts" } as unknown as ApiItem;
		expect(ApiItems.sourceLink(mockItem, undefined)).toBeNull();
	});

	it("returns null when the item has no file path", () => {
		expect(ApiItems.sourceLink({} as unknown as ApiItem, { url: "https://github.com/owner/repo" })).toBeNull();
	});

	it("falls back to filePath/line when fileUrlPath is not available", () => {
		const mockItem = { filePath: "src/fallback.ts", line: 25 } as unknown as ApiItem;
		const result = ApiItems.sourceLink(mockItem, { url: "https://github.com/owner/repo", ref: "blob/develop" });
		expect(result).toBe("https://github.com/owner/repo/blob/develop/src/fallback.ts#L25");
	});
});

describe("ApiItems.inheritance", () => {
	it("extracts the extends type from a class", () => {
		const mockClass = {
			kind: ApiItemKind.Class,
			extendsType: { excerpt: { text: "BaseClass" } },
		} as unknown as ApiClass;
		const result = ApiItems.inheritance(mockClass);
		expect(result.extends).toEqual(["BaseClass"]);
		expect(result.implements).toBeUndefined();
	});

	it("extracts implements types from a class", () => {
		const mockClass = {
			kind: ApiItemKind.Class,
			implementsTypes: [{ excerpt: { text: "IFoo" } }, { excerpt: { text: "IBar" } }],
		} as unknown as ApiClass;
		const result = ApiItems.inheritance(mockClass);
		expect(result.extends).toBeUndefined();
		expect(result.implements).toEqual(["IFoo", "IBar"]);
	});

	it("extracts both extends and implements from a class", () => {
		const mockClass = {
			kind: ApiItemKind.Class,
			extendsType: { excerpt: { text: "BaseClass" } },
			implementsTypes: [{ excerpt: { text: "IFoo" } }],
		} as unknown as ApiClass;
		const result = ApiItems.inheritance(mockClass);
		expect(result.extends).toEqual(["BaseClass"]);
		expect(result.implements).toEqual(["IFoo"]);
	});

	it("extracts extends types from an interface", () => {
		const mockInterface = {
			kind: ApiItemKind.Interface,
			extendsTypes: [{ excerpt: { text: "IBase" } }, { excerpt: { text: "IOther" } }],
		} as unknown as ApiInterface;
		const result = ApiItems.inheritance(mockInterface);
		expect(result.extends).toEqual(["IBase", "IOther"]);
		expect(result.implements).toBeUndefined();
	});

	it("returns an empty object for a class with no inheritance", () => {
		expect(ApiItems.inheritance({ kind: ApiItemKind.Class } as unknown as ApiClass)).toEqual({});
	});

	it("returns an empty object for an interface with no inheritance", () => {
		expect(ApiItems.inheritance({ kind: ApiItemKind.Interface } as unknown as ApiInterface)).toEqual({});
	});
});

describe("ApiItems.categorize", () => {
	const categories = {
		class: { itemKinds: [ApiItemKind.Class] },
		interface: { itemKinds: [ApiItemKind.Interface] },
		function: { itemKinds: [ApiItemKind.Function] },
		type: { itemKinds: [ApiItemKind.TypeAlias] },
		variable: { itemKinds: [ApiItemKind.Variable] },
		enum: { itemKinds: [ApiItemKind.Enum] },
		namespace: { itemKinds: [ApiItemKind.Namespace] },
	};

	it("groups top-level items into their kind categories", () => {
		const { items, uncategorized } = ApiItems.categorize(loadKitchensink(), categories);
		expect(items.function.length).toBeGreaterThan(0);
		expect(items.class.length).toBeGreaterThan(0);
		expect(uncategorized).toEqual([]);
	});

	it("returns unmatched items as uncategorized data instead of emitting", () => {
		const { items, uncategorized } = ApiItems.categorize(loadKitchensink(), {
			class: { itemKinds: [ApiItemKind.Class] },
		});
		expect(items.class.length).toBeGreaterThan(0);
		expect(uncategorized.length).toBeGreaterThan(0);
	});

	it("gives tsdocModifier categories precedence over kind categories", () => {
		const { items } = ApiItems.categorize(loadKitchensink(), {
			sealed: { tsdocModifier: "sealed" },
			class: { itemKinds: [ApiItemKind.Class] },
		});
		expect(items.sealed.map((i) => i.displayName)).toContain("JsonSource");
		expect(items.class.map((i) => i.displayName)).not.toContain("JsonSource");
	});
});

describe("ApiItems.namespaceMembers", () => {
	it("extracts members of top-level namespaces with qualified names", () => {
		const members = ApiItems.namespaceMembers(loadKitchensink());
		expect(members.length).toBeGreaterThan(0);
		for (const member of members) {
			expect(member.qualifiedName).toBe(`${member.namespace.displayName}.${member.item.displayName}`);
		}
	});
});
