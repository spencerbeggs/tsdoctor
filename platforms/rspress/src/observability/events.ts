import { Data } from "effect";

export type EventLevel = "error" | "warn" | "info" | "debug" | "trace";

export const LEVEL_RANK: Record<EventLevel, number> = {
	error: 0,
	warn: 1,
	info: 2,
	debug: 3,
	trace: 4,
};

export interface EventContext {
	/**
	 * Correlates every event from one build.
	 *
	 * @remarks
	 * Optional at the emit site: `emit` fills it from the `BuildId` Reference.
	 * It used to be required, and 24 sites satisfied that requirement by writing
	 * `buildId: ""` — a required field callers cannot reach is a field that gets
	 * faked. Readers see it populated.
	 */
	readonly buildId?: string;
	readonly apiScope?: string;
	readonly packageName?: string;
	readonly version?: string;
	readonly locale?: string;
	readonly entryPoint?: string;
	readonly route?: string;
	readonly file?: string;
	readonly symbol?: string;
}

interface Base {
	readonly ctx: EventContext;
	readonly level: EventLevel;
}

/**
 * The render-phase path that produced a code block, used to attribute
 * `CodeBlockProcessed` timings.
 */
export type CodeBlockComponent = "ApiSignature" | "ApiMember" | "ApiExample" | "with-api";

export interface ImportRef {
	readonly from: string;
	readonly symbols: readonly string[];
}

export type PluginEvent = Data.TaggedEnum<{
	// Lifecycle spine
	BuildStarted: Base & { readonly mode: "dev" | "prod"; readonly apiCount: number };
	PhaseStarted: Base & { readonly phase: string };
	PhaseCompleted: Base & { readonly phase: string; readonly durationMs: number };
	BuildCompleted: Base & { readonly durationMs: number; readonly totals: Record<string, number> };
	BuildProgress: Base & {
		readonly phase: "resolve" | "generate";
		readonly elapsedMs: number;
		readonly vfsFiles: number;
		readonly externalPackages: number;
		readonly apisCompleted: number;
		readonly apisTotal: number;
		readonly pages: number;
		readonly codeBlocks: number;
		readonly delta: number;
	};
	ApiDocsCompleted: Base & { readonly packageName: string };
	BuildFailed: Base & { readonly phase: string; readonly error: string };
	SlowOperation: Base & { readonly operation: string; readonly durationMs: number; readonly threshold: number };

	// Config parse & merge
	ConfigCascadeWarning: Base & { readonly field: string; readonly chosen: string; readonly ignored: readonly string[] };
	ConfigValidationWarning: Base & { readonly field: string; readonly value: string; readonly reason: string };

	// Model loading
	ModelLoaded: Base & { readonly entryPoints: number; readonly itemCount: number; readonly durationMs: number };
	ModelLoadFailed: Base & { readonly modelPath: string; readonly reason: string };

	// Type loading & VFS
	TypeRegistryEvent: Base & { readonly kind: string; readonly detail: string };
	ExternalPackageSkipped: Base & { readonly reason: string };
	VfsGenerated: Base & {
		readonly file: string;
		readonly declCount: number;
		readonly contentHash: string;
		readonly content?: string;
	};
	ImportsPrepended: Base & { readonly file: string; readonly imports: readonly ImportRef[] };
	TsCacheCreated: Base & { readonly compilerOptions: string; readonly durationMs: number };
	VfsMerged: Base & { readonly totalFiles: number; readonly packages: readonly string[] };
	TwoslashInitialized: Base & { readonly durationMs: number; readonly vfsFileCount: number };
	/** A persisted Twoslash generation was restored (or found absent) at startup. */
	TwoslashCacheLoaded: Base & { readonly envHash: string; readonly entries: number; readonly degraded: boolean };
	/** End-of-build outcome of the Twoslash result cache. */
	TwoslashCacheSaved: Base & {
		readonly envHash: string;
		readonly hits: number;
		readonly misses: number;
		readonly entries: number;
		readonly persisted: boolean;
	};

	// Multi-entry & routing
	RouteCollisionDetected: Base & { readonly items: readonly string[] };

	// Page gen & code blocks
	PageGenerated: Base & {
		readonly item: string;
		readonly category: string;
		readonly codeblockCount: number;
		readonly durationMs: number;
	};
	ItemSkipped: Base & { readonly item: string; readonly kind: string; readonly reason: string };
	CodeBlockProcessed: Base & {
		readonly lang: string;
		/**
		 * Which render-phase path produced this block. The three `Api*` values are the
		 * JSX components page generators emit (rendered by `remarkApiCodeblocks`);
		 * `with-api` is a user-authored ```ts with-api fence (`remarkWithApi`).
		 */
		readonly component: CodeBlockComponent;
		/** True when the Twoslash transformer actually ran on this block. */
		readonly twoslash: boolean;
		/**
		 * Time inside the Twoslash transformer's `preprocess` hook — the whole
		 * `twoslasher()` type-check. Zero when `twoslash` is false.
		 */
		readonly twoslashMs: number;
		/** Shiki tokenization/rendering only: the `codeToHast` call minus `twoslashMs`. */
		readonly shikiMs: number;
		/** Whole-block wall clock, including Prettier and cross-linking around the render. */
		readonly totalMs: number;
		readonly slow: boolean;
	};
	TwoslashDiagnostic: Base & {
		readonly file: string;
		readonly line: number;
		readonly col: number;
		readonly code: number;
		readonly message: string;
		readonly snippet: string;
	};
	TwoslashCheckFailed: Base & {
		readonly file: string;
		readonly code: number;
		readonly fsMapKeys: readonly string[];
		readonly compilerOptions: string;
	};
	PrettierError: Base & { readonly file: string; readonly reason: string };
	ShikiError: Base & { readonly file: string; readonly reason: string };

	// Write, snapshot & cleanup
	FileDecision: Base & {
		readonly file: string;
		readonly status: "new" | "modified" | "unchanged";
		readonly contentHash: string;
		readonly frontmatterHash: string;
		readonly source: "snapshot" | "disk-fallback";
	};
	StaleDeleted: Base & { readonly file: string };
	OrphanDeleted: Base & { readonly file: string };
	EmptyDirRemoved: Base & { readonly dir: string };

	// LLMs
	LlmsRoutesBuilt: Base & { readonly count: number };
	LlmsPrefixProcessed: Base & { readonly prefix: string };
	LlmsPackageFilesGenerated: Base & { readonly dir: string; readonly files: readonly string[] };
}>;

export const PluginEvent = Data.taggedEnum<PluginEvent>();

export function levelOf(event: PluginEvent): EventLevel {
	return event.level;
}
