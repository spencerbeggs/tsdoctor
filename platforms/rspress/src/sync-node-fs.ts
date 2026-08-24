import fsSync from "node:fs";
import { Effect, FileSystem, Layer, Option, Path, PlatformError } from "effect";

/**
 * A synchronous, read-only `FileSystem` implementation over `node:fs`'s sync
 * API, covering exactly the members `@tsdoctor/bundle`'s discovery walks:
 * `exists`, `stat`, `readFileString`, `readDirectory` and `readLink`.
 *
 * The config helpers (`fromDir`/`fromParentDir`) are a SYNC public API called
 * at rspress.config evaluation time, while bundle discovery is an Effect
 * program over the `FileSystem` service. `@effect/platform-node`'s
 * `NodeFileSystem` is promise-backed, so running discovery under
 * `Effect.runSync` needs this bridge; every other member stays
 * `layerNoop`-denied, which is deliberate — a new discovery dependency on an
 * unimplemented member should fail loudly here, not silently misbehave.
 */

const tagOf = (cause: unknown): PlatformError.SystemErrorTag => {
	const code = (cause as { code?: string } | null)?.code;
	if (code === "ENOENT") return "NotFound";
	if (code === "EACCES" || code === "EPERM") return "PermissionDenied";
	return "Unknown";
};

const fail = (method: string, pathOrDescriptor: string, cause: unknown) =>
	PlatformError.systemError({ _tag: tagOf(cause), module: "FileSystem", method, pathOrDescriptor, cause });

const typeOf = (stats: fsSync.Stats): FileSystem.File.Info["type"] => {
	if (stats.isDirectory()) return "Directory";
	if (stats.isSymbolicLink()) return "SymbolicLink";
	if (stats.isFile()) return "File";
	return "Unknown";
};

const infoFromStats = (stats: fsSync.Stats): FileSystem.File.Info => ({
	type: typeOf(stats),
	mtime: Option.some(stats.mtime),
	atime: Option.some(stats.atime),
	birthtime: Option.some(stats.birthtime),
	dev: stats.dev,
	ino: Option.some(stats.ino),
	mode: stats.mode,
	nlink: Option.some(stats.nlink),
	uid: Option.some(stats.uid),
	gid: Option.some(stats.gid),
	rdev: Option.some(stats.rdev),
	size: FileSystem.Size(stats.size),
	blksize: Option.some(FileSystem.Size(stats.blksize)),
	blocks: Option.some(stats.blocks),
});

const syncFileSystem = FileSystem.layerNoop({
	exists: (path) => Effect.sync(() => fsSync.existsSync(path)),
	stat: (path) =>
		Effect.try({ try: () => infoFromStats(fsSync.statSync(path)), catch: (cause) => fail("stat", path, cause) }),
	readFileString: (path) =>
		Effect.try({
			try: () => fsSync.readFileSync(path, "utf8"),
			catch: (cause) => fail("readFileString", path, cause),
		}),
	readDirectory: (path) =>
		Effect.try({ try: () => fsSync.readdirSync(path), catch: (cause) => fail("readDirectory", path, cause) }),
	readLink: (path) =>
		Effect.try({ try: () => fsSync.readlinkSync(path), catch: (cause) => fail("readLink", path, cause) }),
});

/**
 * The full sync environment bundle discovery runs under from the config
 * helpers: the sync `FileSystem` bridge plus the (already sync) `Path`
 * service.
 */
export const SyncDiscoveryLayer = Layer.mergeAll(syncFileSystem, Path.layer);
