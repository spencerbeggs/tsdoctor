/**
 * Shared private text helpers.
 *
 * @internal
 */

/** Escape a literal string for embedding in a RegExp pattern. */
export const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
