/* v8 ignore start -- Prettier integration wrapper, tested via page generator integration tests */
import { formatExampleCode } from "@tsdoctor/pages";
import { Effect, Result } from "effect";
import { PluginEvent as PE } from "./observability/events.js";
import { emitSync, syncBuildId } from "./observability/sync-emitter.js";

/**
 * Result of formatting code with Prettier
 */
export interface FormatResult {
	/** The formatted code (or original if formatting failed) */
	code: string;
	/** Whether formatting was successful */
	success: boolean;
	/** Error message if formatting failed */
	error?: string;
	/** Time taken to format in milliseconds */
	formatTime: number;
}

/**
 * Format code using Prettier.
 *
 * The formatting itself is `formatExampleCode` in `@tsdoctor/pages`, so both
 * adapters format identically. This wrapper keeps the adapter's fallthrough
 * contract: a typed `ExampleFormatError` becomes a `PrettierError` event on
 * the bus and the original code is returned.
 *
 * @param code - The code to format
 * @param language - The code fence language (e.g., "typescript", "ts", "js")
 * @returns FormatResult with formatted code and metadata
 */
export async function formatCode(code: string, language: string): Promise<FormatResult> {
	const start = performance.now();
	const result = await Effect.runPromise(Effect.result(formatExampleCode(code, language)));
	const formatTime = performance.now() - start;

	if (Result.isSuccess(result)) {
		return { code: result.success, success: true, formatTime };
	}

	const cause = result.failure.cause;
	const errorMsg = cause instanceof Error ? cause.message : String(cause);

	// Metric derived from PrettierError event in MetricsSink
	emitSync(PE.PrettierError({ ctx: { buildId: syncBuildId() }, file: "unknown", reason: errorMsg, level: "warn" }));

	return { code, success: false, error: errorMsg, formatTime };
}
