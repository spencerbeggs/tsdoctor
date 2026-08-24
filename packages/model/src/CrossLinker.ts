/**
 * Link known API item names in prose to their docs. Immutable: construct one
 * per build from either a precomputed name → route map ({@link CrossLinker.fromRoutes})
 * or item refs plus an injected URL scheme ({@link CrossLinker.fromRefs}).
 * Pure.
 *
 * @packageDocumentation
 */

import { escapeRegExp } from "./internal/text.js";
import type { ApiItemRef, RouteFormatter } from "./types.js";

/**
 * Links known API item names in prose to their documentation routes. Matching
 * is longest-name-first with word boundaries, skipping code spans and existing
 * links.
 *
 * @public
 */
export class CrossLinker {
	private readonly routesByName: ReadonlyMap<string, string>;
	/** Names sorted longest-first so "HookEvent" matches before "Hook". */
	private readonly orderedNames: ReadonlyArray<string>;

	private constructor(routesByName: ReadonlyMap<string, string>) {
		this.routesByName = routesByName;
		this.orderedNames = [...routesByName.keys()].sort((a, b) => b.length - a.length);
	}

	/**
	 * Build from a precomputed name → route map (member anchors and qualified
	 * names already baked into the routes). The primary pipeline path.
	 */
	static fromRoutes(routes: ReadonlyMap<string, string>): CrossLinker {
		return new CrossLinker(new Map(routes));
	}

	/**
	 * Build from item refs plus an injected {@link RouteFormatter}, so each
	 * consumer supplies its own URL scheme. Routes are evaluated eagerly at
	 * construction.
	 */
	static fromRefs(refs: ReadonlyArray<ApiItemRef>, routeFor: RouteFormatter): CrossLinker {
		return new CrossLinker(new Map(refs.map((r) => [r.name, routeFor(r)])));
	}

	/** The identity cross-linker: `link(text)` returns `text` unchanged. */
	static readonly empty: CrossLinker = new CrossLinker(new Map());

	/** Wrap known item names in markdown links, skipping code spans + existing links. */
	link(text: string): string {
		let result = text;
		for (const name of this.orderedNames) {
			const route = this.routesByName.get(name);
			if (route === undefined) continue;
			const regex = new RegExp(`\\b${escapeRegExp(name)}\\b`, "g");
			result = result.replace(regex, (match, offset: number) => {
				const before = result.slice(0, offset);
				if (before.endsWith("](") || before.endsWith("[")) return match; // already a link
				if ((before.match(/`/g) || []).length % 2 === 1) return match; // inside a code span
				return `[${match}](${route})`;
			});
		}
		return result;
	}

	/**
	 * Wrap known item names in HTML `<a>` anchors — for text rendered as HTML
	 * rather than markdown. Skips matches inside an open `<a>` tag.
	 */
	linkHtml(text: string): string {
		let result = text;
		for (const name of this.orderedNames) {
			const route = this.routesByName.get(name);
			if (route === undefined) continue;
			const regex = new RegExp(`\\b${escapeRegExp(name)}\\b(?![a-zA-Z])`, "g");
			result = result.replace(regex, (match, offset: number) => {
				const beforeMatch = result.substring(0, offset);
				if (beforeMatch.includes("<a") && !beforeMatch.includes("</a>")) {
					return match;
				}
				return `<a href="${route}">${match}</a>`;
			});
		}
		return result;
	}
}
