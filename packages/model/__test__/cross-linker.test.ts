import { describe, expect, it } from "vitest";

import type { ApiItemRef } from "../src/index.js";
import { CrossLinker } from "../src/index.js";

const refs: ApiItemRef[] = [
	{ name: "Pipeline", kind: "class", slug: "pipeline" },
	{ name: "Config", kind: "interface", slug: "config" },
];

const routeFor = (ref: ApiItemRef): string => `silk://packages/x/api/${ref.kind}/${ref.slug}`;

describe("CrossLinker.fromRefs", () => {
	const linker = CrossLinker.fromRefs(refs, routeFor);

	it("links a known name via the injected route formatter", () => {
		expect(linker.link("See Pipeline for details.")).toBe(
			"See [Pipeline](silk://packages/x/api/class/pipeline) for details.",
		);
	});

	it("does not link inside a code span", () => {
		expect(linker.link("Use `Pipeline` directly.")).toBe("Use `Pipeline` directly.");
	});

	it("does not double-link text already in a markdown link", () => {
		expect(linker.link("[Pipeline](/elsewhere)")).toBe("[Pipeline](/elsewhere)");
	});

	it("leaves unknown names untouched", () => {
		expect(linker.link("See Unknown.")).toBe("See Unknown.");
	});

	it("links the longest matching name, not a shorter prefix", () => {
		const linker = CrossLinker.fromRefs(
			[
				{ name: "Pipeline", kind: "class", slug: "pipeline" },
				{ name: "PipelineConfig", kind: "interface", slug: "pipelineconfig" },
			],
			routeFor,
		);
		expect(linker.link("See PipelineConfig.")).toBe(
			"See [PipelineConfig](silk://packages/x/api/interface/pipelineconfig).",
		);
	});

	it("links every occurrence of a name", () => {
		const linker = CrossLinker.fromRefs([{ name: "Pipeline", kind: "class", slug: "pipeline" }], routeFor);
		const out = linker.link("Pipeline talks to Pipeline.");
		expect(out.match(/\[Pipeline\]/g)).toHaveLength(2);
	});
});

describe("CrossLinker.fromRoutes", () => {
	it("links using precomputed routes, including member anchors", () => {
		const linker = CrossLinker.fromRoutes(
			new Map([
				["Pipeline", "/api/class/pipeline"],
				["Pipeline.run", "/api/class/pipeline#run"],
			]),
		);
		expect(linker.link("Call Pipeline.run soon.")).toBe("Call [Pipeline.run](/api/class/pipeline#run) soon.");
	});
});

describe("CrossLinker.empty", () => {
	it("is the identity", () => {
		expect(CrossLinker.empty.link("See Pipeline.")).toBe("See Pipeline.");
		expect(CrossLinker.empty.linkHtml("See Pipeline.")).toBe("See Pipeline.");
	});
});

describe("CrossLinker#linkHtml", () => {
	const linker = CrossLinker.fromRoutes(new Map([["Pipeline", "/api/class/pipeline"]]));

	it("wraps known names in anchor tags", () => {
		expect(linker.linkHtml("See Pipeline for details.")).toBe(
			'See <a href="/api/class/pipeline">Pipeline</a> for details.',
		);
	});

	it("does not link inside an open anchor tag", () => {
		const input = '<a href="/x">Pipeline</a> and Pipeline';
		const out = linker.linkHtml(input);
		expect(out).toBe('<a href="/x">Pipeline</a> and <a href="/api/class/pipeline">Pipeline</a>');
	});

	it("does not match names embedded in longer identifiers", () => {
		expect(linker.linkHtml("PipelineFactory")).toBe("PipelineFactory");
	});
});
