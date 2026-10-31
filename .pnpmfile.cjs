// Temporary bridge (effected Effect 4.1.1 upgrade, step 2.5): the build
// toolchain (@savvy-web/*, okfit, vitest-agent, pluginfinity, published
// @tsdoctor/*) still loads @effected/* packages built on Effect 4.0.7, which
// import the root `Crypto` that Effect 4.1 removed. Run them, and the tools that load them, on
// the effect they were built on. Workspace packages (`private: true`) are left
// alone. Remove once every tool has republished on an Effect 4.1 @effected
// release (then no lockfile `packages:` entry names effect@4.0.7).
const BRIDGED = "4.0.7";
const TOOLCHAIN = [
	"@savvy-web/",
	"@okfit/",
	"@tsdoctor/",
	"@vitest-agent/",
	"rolldown-pnpm-config",
	"pluginfinity",
	"@pluginfinity/",
];
const isEffectLine = (name, spec) =>
	(name === "effect" || name.startsWith("@effect/")) && /^[\^~=]*4\./.test(String(spec).trim());
const reachesKit = (pkg) =>
	[pkg.dependencies, pkg.peerDependencies, pkg.optionalDependencies].some((deps) =>
		Object.keys(deps ?? {}).some((name) => name.startsWith("@effected/")),
	);
// A package that already declares effect on 4.1 or later (the current kit's
// `~4.1.0` peer) is built on it and must not be bridged.
const builtOn41 = (pkg) =>
	[pkg.dependencies, pkg.peerDependencies, pkg.optionalDependencies].some((deps) => {
		const spec = deps?.effect;
		return spec !== undefined && /^[\^~=]*4\.(?:[1-9]|\d{2,})\./.test(String(spec).trim());
	});
function readPackage(pkg) {
	if (pkg.private === true || !pkg.name || builtOn41(pkg)) return pkg;
	const bridged =
		(pkg.version === BRIDGED && isEffectLine(pkg.name, pkg.version)) ||
		pkg.name.startsWith("@effected/") ||
		TOOLCHAIN.some((p) => pkg.name.startsWith(p)) ||
		reachesKit(pkg);
	if (!bridged) return pkg;
	const pinned = {};
	for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
		for (const name of Object.keys(pkg[field] ?? {})) {
			if (!isEffectLine(name, pkg[field][name])) continue;
			delete pkg[field][name];
			pinned[name] = `npm:${name}@${BRIDGED}`;
		}
	}
	if (Object.keys(pinned).length > 0) pkg.dependencies = { ...pkg.dependencies, ...pinned };
	return pkg;
}
module.exports = { hooks: { readPackage } };
