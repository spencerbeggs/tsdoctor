import { assert, describe, it } from "@effect/vitest";
import type { CompilerOptions } from "@effected/tsconfig-json";
import { Effect } from "effect";
import { TsEnvironment, VirtualPackage, mergeVfs } from "../src/index.js";

// JSON form — TsEnvironment converts to the compiler's numeric enums itself,
// so the tests need no compile-time dependency on the typescript package.
const compilerOptions: CompilerOptions.Type = {
	target: "es2022",
	module: "esnext",
	moduleResolution: "bundler",
	strict: true,
};

/** Flatten a `string | DiagnosticMessageChain` without importing typescript. */
const flattenMessage = (message: unknown): string => {
	if (typeof message === "string") return message;
	const chain = message as { readonly messageText: string; readonly next?: ReadonlyArray<unknown> };
	return [chain.messageText, ...(chain.next ?? []).map(flattenMessage)].join(" ");
};

describe("TsEnvironment", () => {
	it.effect("compiles a Twoslash-sized sample against a fixture Vfs", () =>
		Effect.gen(function* () {
			// The port's end-to-end proof: a VirtualPackage-produced Vfs typechecks.
			const vfs = mergeVfs(
				VirtualPackage.create(
					"my-types",
					"1.0.0",
					"export declare const answer: number;\nexport interface User { readonly id: string }\n",
				).toVfs(),
			);
			const environment = yield* TsEnvironment.make({ vfs, compilerOptions, projectRoot: "/twoslash" });
			environment.createFile(
				"/twoslash/sample.ts",
				'import { answer, type User } from "my-types";\nconst x: number = answer;\nconst u: User = { id: String(x) };\nexport { u };\n',
			);
			const diagnostics = [
				...environment.languageService.getSemanticDiagnostics("/twoslash/sample.ts"),
				...environment.languageService.getSyntacticDiagnostics("/twoslash/sample.ts"),
			];
			assert.deepStrictEqual(
				diagnostics.map((diagnostic) => flattenMessage(diagnostic.messageText)),
				[],
			);
		}),
	);

	it.effect("surfaces type errors through the language service", () =>
		Effect.gen(function* () {
			const vfs = VirtualPackage.create("my-types", "1.0.0", "export declare const answer: number;").toVfs();
			const environment = yield* TsEnvironment.make({ vfs, compilerOptions, projectRoot: "/twoslash" });
			environment.createFile(
				"/twoslash/broken.ts",
				'import { answer } from "my-types";\nconst wrong: string = answer;\nexport { wrong };\n',
			);
			const diagnostics = environment.languageService.getSemanticDiagnostics("/twoslash/broken.ts");
			// TS2322: Type 'number' is not assignable to type 'string'. Structural
			// param types: under the tsgo dev typescript the @typescript/vfs
			// declarations degrade, so nothing here may lean on inference.
			assert.isTrue(
				diagnostics.some((diagnostic: { readonly code: number }) => diagnostic.code === 2322),
				`expected TS2322 among: ${diagnostics.map((diagnostic: { readonly code: number }) => diagnostic.code).join(", ")}`,
			);
		}),
	);

	it.effect("re-roots bare node_modules keys under the project root", () =>
		Effect.gen(function* () {
			const environment = yield* TsEnvironment.make({
				vfs: new Map([["node_modules/probe/index.d.ts", "export {};"]]),
				compilerOptions,
				projectRoot: "/rooted",
			});
			assert.isTrue(environment.sys.fileExists("/rooted/node_modules/probe/index.d.ts"));
		}),
	);
});
