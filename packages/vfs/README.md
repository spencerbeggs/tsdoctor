# @tsdoctor/vfs

[![npm](https://img.shields.io/npm/v/@tsdoctor%2Fvfs?label=npm&color=cb3837)](https://www.npmjs.com/package/@tsdoctor/vfs)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

The virtual TypeScript project behind a documentation build: the `Vfs` currency type, declaration-backed virtual packages, `@typescript/vfs` environments over them, and the compiler-option resolution that decides how code in those environments type-checks.

## Why @tsdoctor/vfs

Tooling that type-checks code samples needs a TypeScript project that never touches disk — a map of paths to sources, a synthetic `package.json` so module resolution behaves like the real thing, and a language service built over both. Two independent concerns need exactly that substrate: fetching third-party declarations from a registry, and reconstructing declarations from an API model. This package is the substrate they share, so neither has to depend on the other.

It owns the compiler options too, and that pairing is deliberate. Options arrive in two spellings: the tsconfig one a user writes (`target: "es2022"`), and the programmatic one the compiler takes (`ts.ScriptTarget.ES2022`). A build that converts between them in more than one place will eventually disagree with itself. Here the conversion happens once, options a documentation tool cannot act on are rejected at the boundary instead of cast through it, and the environment that consumes them lives next door.

`@tsdoctor/registry` builds on it to resolve external package types; `@tsdoctor/model` builds on it to turn an API Extractor model into a virtual package.

## Install

```bash
npm install @tsdoctor/vfs effect @effected/tsconfig-json
```

```bash
pnpm add @tsdoctor/vfs effect @effected/tsconfig-json
```

Requires Node.js >=24.11.0. This is an ESM-only package. `effect` and `@effected/tsconfig-json` are required peers — the compiler-option schemas are built from the kit's own field definitions, so they load with the entry point. `typescript` and `@typescript/vfs` are optional and needed only by `TsEnvironment.make`, which imports them lazily:

```bash
# for TsEnvironment.make
npm install typescript @typescript/vfs
```

A consumer that only builds and merges VFS maps never loads the compiler.

## What you get

### The VFS substrate

- **`Vfs`** — the currency type: a `Map<string, string>` of `node_modules/`-prefixed paths to file contents. Every loading operation produces one and every TypeScript integration consumes one.
- **`mergeVfs` / `prefixVfs`** — combine maps left to right (later wins on a path collision), and root one package's entries under `node_modules/<name>/`.
- **`isTypeDefinition`** — whether a path names a declaration file. The single spelling of that predicate.
- **`VirtualPackage`** — a named, versioned set of declaration entries that renders to a `Vfs` with a synthetic `package.json`. `create` for a single `index.d.ts`, `createMultiEntry` for one declaration file per entry point behind a synthetic `exports` map. Subclass-friendly, which is how an API-model-backed package is built on top of it.
- **`TsEnvironment.make`** — a `@typescript/vfs` `VirtualTypeScriptEnvironment` over a `Vfs` plus the TypeScript default libs. Takes options in the tsconfig spelling and converts internally, so a caller needs no compile-time dependency on `typescript`. A missing optional peer fails as a typed **`TsEnvironmentError`** rather than crashing at import.

### Compiler-option resolution

- **`TypeResolutionCompilerOptions`** — the whitelist of options allowed to influence how an example type-checks, picked from `@effected/tsconfig-json`'s own field schemas rather than restated. Passing through options the tool does not understand would let an unrelated build setting silently change a documentation build.
- **`decodeCompilerOptions`** — decode untrusted input in either spelling and narrow it to the whitelist, returning a `Result` that fails on a value the compiler cannot act on instead of casting it through.
- **`toProgrammaticCompilerOptions`** — the one conversion from the tsconfig spelling to the compiler's numeric enums. Fingerprint the encoded value, not the decoded one, or two spellings of the same configuration build two identical environments under different keys.
- **`parseTsConfig`** — read a `tsconfig.json` into whitelisted options, with `extends` chain resolution (package specifiers included), JSONC parsing and relative paths owned by `@effected/tsconfig-json`. Failures raise **`TsConfigParseError`** carrying the config path.
- **`DEFAULT_COMPILER_OPTIONS`** — the documentation defaults: ESNext target and module, bundler resolution, non-strict, `skipLibCheck`, and a `lib` covering ESNext plus DOM. Held in the tsconfig spelling, the same one users write.
- **`mergeCompilerOptions`** — layer one option set over another, later winning per key. Arrays (`lib`, `types`) are replaced wholesale rather than concatenated, matching TypeScript's own `extends` semantics.
- **`resolveTypeScriptConfig`** — the full cascade: defaults, then a global config, then a per-API one, each level loading its `tsconfig` before merging its inline `compilerOptions` on top. `resolveTypeScriptConfigSingle` resolves one level synchronously (path-based `tsconfig` only); `resolveTypeScriptConfigSingleAsync` also accepts a `tsconfig` given as a loader function.
- **`TypeScriptConfig` / `CompilerOptionsInput`** — how a caller points at configuration, and the deliberately loose shape their inline options arrive in before decoding. Two types rather than one, so untrusted input and decoded output cannot be confused at a call site.

## Quick start

Build a virtual package from declaration text, resolve the compiler options an example should be checked under, and type-check against both.

```ts
import { Effect } from "effect";
import { TsEnvironment, VirtualPackage, mergeVfs, resolveTypeScriptConfig } from "@tsdoctor/vfs";

const vfs = mergeVfs(
  VirtualPackage.create(
    "my-types",
    "1.0.0",
    "export declare const answer: number;\nexport interface User { readonly id: string }\n",
  ).toVfs(),
);
console.log([...vfs.keys()]);
// ["node_modules/my-types/package.json", "node_modules/my-types/index.d.ts"]

// Defaults, then the project's tsconfig, then an inline override on top.
const compilerOptions = await resolveTypeScriptConfig(process.cwd(), { tsconfig: "tsconfig.json" }, {
  compilerOptions: { strict: true },
});

const program = Effect.gen(function* () {
  const environment = yield* TsEnvironment.make({ vfs, compilerOptions, projectRoot: "/docs" });
  environment.createFile("/docs/sample.ts", 'import { answer } from "my-types";\nexport const x: number = answer;\n');
  return environment.languageService.getSemanticDiagnostics("/docs/sample.ts");
});

console.log((await Effect.runPromise(program)).length);
// diagnostic count — 0 when the sample type-checks against the virtual package
```

`resolveTypeScriptConfig` returns the tsconfig spelling, which is what `TsEnvironment.make` takes; nothing in this example needs to import `typescript`.

## Provenance

Extracted from `@tsdoctor/registry`, which had no internal consumer for the VFS half while `@tsdoctor/model` needed it. Hosting these types in the registry would have forced a dependency in one direction or the other — the registry onto an API model it does not read, or the model onto the registry's CDN and cache stack it does not use. The registry kept its own job, fetching and caching external package types into a `Vfs`, and shed the `typescript`, `@typescript/vfs` and `@effected/tsconfig-json` peers along with the environment builder. The compiler-option resolution came from the RSPress adapter, where it sat beside the environment it configures.

## License

[MIT](LICENSE)
