/**
 * The plugin's shared platform and XDG layers.
 *
 * @remarks
 * Both cache-backed services — the type registry and the Twoslash result cache
 * — need a Node platform and an XDG app-directory root, and both used to
 * declare their own. Two consequences, both fixed by having one home:
 *
 * 1. **Two distinct layer references build twice.** Layer memoization is by
 *    reference, so a second `Layer.mergeAll(NodeFileSystem.layer, Path.layer)`
 *    is a different layer as far as the memo map is concerned, and the XDG
 *    resolution ran once per consumer.
 * 2. **The namespace literal was copy-pasted.** The house style bans exactly
 *    this: when two sibling layers must agree on an identity string, the
 *    agreement has to be structural rather than textual. A drift here is
 *    silent and permanent — the caches move to a different directory, every
 *    lookup misses, and a build that should hit a warm Twoslash cache goes
 *    cold forever with no error and nothing in the output to notice.
 *
 * @packageDocumentation
 */

import { NodeFileSystem } from "@effect/platform-node";
import { AppDirs, Xdg } from "@effected/xdg";
import { Layer, Path } from "effect";

/**
 * The XDG namespace every cache this plugin keeps lives under.
 *
 * @remarks
 * One definition, deliberately. Changing it invalidates every on-disk cache —
 * the type registry's `metadata.sqlite` and the Twoslash result cache's
 * `twoslash.sqlite` — which is a cold refetch and a full re-type-check, not an
 * error. That was accepted once, at the phase-2 rename from
 * `type-registry-effect`; do not do it casually.
 */
export const TSDOCTOR_NAMESPACE = "tsdoctor";

/** Node platform services: the filesystem and path implementations. */
export const PlatformLive = Layer.mergeAll(NodeFileSystem.layer, Path.layer);

/** XDG application directories rooted at {@link TSDOCTOR_NAMESPACE}. */
export const AppDirsLive = AppDirs.layer({ namespace: TSDOCTOR_NAMESPACE }).pipe(
	Layer.provide(Layer.mergeAll(Xdg.layer, PlatformLive)),
);
