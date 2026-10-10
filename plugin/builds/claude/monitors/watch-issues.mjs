#!/usr/bin/env node
// Background monitor: polls .api-docs/build/issues.json artifacts and prints one
// notification line per site once its Twoslash/doc issue count settles at a
// non-zero value. A count still moving build-to-build (an agent actively
// fixing, or a fresh build) is held back until it holds steady across a short
// quiet period, so the monitor never fires for a build already in flight.
import { globSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const POLL_MS = 2000;
const STABLE_POLLS = Math.max(0, Number(process.env.API_DOCS_MONITOR_STABLE_POLLS ?? 3) || 0);

// The pluginfinity monitor contract: when PLUGINFINITY_MONITOR_MAX_TICKS is a
// positive integer, stop after that many polls. Only a test sets it; anything
// else leaves the monitor unbounded.
export function maxTicks(raw) {
	return /^[1-9][0-9]*$/.test(raw ?? "") ? Number(raw) : Number.POSITIVE_INFINITY;
}

// The .api-docs/build/issues.json file contains only doc-build issues, so every
// warning + error counts. TS-coded issues are Twoslash errors in examples.
function countDocIssues(issues) {
	return (issues?.warnings?.length ?? 0) + (issues?.errors?.length ?? 0);
}

async function scan() {
	const files = globSync(["**/.api-docs/build/issues.json"], {
		cwd: ROOT,
		exclude: (p) => p.includes("node_modules"),
	});
	const current = [];
	for (const rel of files) {
		const path = join(ROOT, rel);
		try {
			const issues = JSON.parse(await readFile(path, "utf8"));
			current.push({
				path,
				pkg: typeof issues?.package === "string" ? issues.package : rel,
				target: typeof issues?.target === "string" ? issues.target : "?",
				count: countDocIssues(issues),
			});
		} catch {
			// partial write / parse error — skip and retry on the next poll
		}
	}
	return current;
}

// Pure debounce step (identical shape to silk's watch-issues). A non-zero
// count fires only once its streak reaches `minStablePolls` and it differs
// from the last-notified value; a return to zero clears the dedup.
export function diagnose(current, prev, minStablePolls) {
	const lines = [];
	const next = new Map();
	for (const c of current) {
		const before = prev.get(c.path);
		const streak = before && before.count === c.count ? before.streak + 1 : 0;
		let notified = before?.notified;
		if (c.count === 0) {
			notified = undefined;
		} else if (streak >= minStablePolls && notified !== c.count) {
			const plural = c.count === 1 ? "" : "s";
			lines.push(
				`docs: ${c.pkg} has ${c.count} doc-build issue${plural} in ${c.target} — read .api-docs/build/issues.json and fix the examples (dispatch the api-docs:rspress-docs agent for the affected package); if a build or fixing agent is already in flight, let it finish before acting on this line`,
			);
			notified = c.count;
		}
		next.set(c.path, { count: c.count, streak, notified });
	}
	return { lines, next };
}

async function main() {
	const once = process.argv.includes("--once");
	const minStablePolls = once ? 0 : STABLE_POLLS;
	const limit = once ? 1 : maxTicks(process.env.PLUGINFINITY_MONITOR_MAX_TICKS);
	// A closed stdout means the host stopped listening: end quietly.
	process.stdout.on("error", () => process.exit(0));
	let prev = new Map();
	let ticks = 0;
	const tick = async () => {
		ticks += 1;
		try {
			const { lines, next } = diagnose(await scan(), prev, minStablePolls);
			prev = next;
			for (const line of lines) console.log(line);
		} catch {
			// never crash the session
		}
	};
	await tick();
	if (ticks < limit) {
		const loop = async () => {
			await tick();
			if (ticks < limit) setTimeout(loop, POLL_MS);
		};
		setTimeout(loop, POLL_MS);
	}
}

function invokedDirectly() {
	const entry = process.argv[1];
	if (!entry) return false;
	try {
		return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
	} catch {
		return false;
	}
}

if (invokedDirectly()) {
	await main();
}
