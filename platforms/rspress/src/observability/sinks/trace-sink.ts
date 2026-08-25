import fs from "node:fs";
import path from "node:path";
import type { PluginEvent } from "../events.js";
import type { EventSink } from "./types.js";

function openTracePath(p: string): void {
	fs.mkdirSync(path.dirname(p), { recursive: true });
	// Truncate any prior trace for this path.
	fs.writeFileSync(p, "");
}

/**
 * Create a JSONL trace sink, opening the file eagerly at construction.
 *
 * The path is always known up front: `resolveObservability` derives it from
 * `cwd`, which (unlike the RSPress `outDir`) is available at plugin-factory
 * time. The sink previously supported a deferred mode — construct with no path,
 * bind one later via `setPath` — for the era when the path depended on
 * `outDir`; nothing has called it since, so it is gone.
 */
export function makeTraceSink(tracePath: string): EventSink & { flush: () => void } {
	openTracePath(tracePath);
	return {
		minLevel: "trace",
		capturesPayload: true,
		handle: (event: PluginEvent) => {
			fs.appendFileSync(tracePath, `${JSON.stringify(event)}\n`);
		},
		flush: () => {
			// Synchronous appends mean nothing is buffered; flush is a no-op hook
			// kept for symmetry and future buffering.
		},
	};
}
