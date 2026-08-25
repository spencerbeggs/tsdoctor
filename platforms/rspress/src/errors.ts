import { Data } from "effect";

const ConfigValidationErrorBase = Data.TaggedError("ConfigValidationError");

export class ConfigValidationError extends ConfigValidationErrorBase<{
	/** The config field at fault, as a user would spell it: `externalPackages`. */
	readonly field: string;
	readonly reason: string;
	/**
	 * The original failure, when this wraps one.
	 *
	 * @remarks
	 * Carried rather than stringified into {@link reason}. Three of this error's
	 * call sites wrap something that threw — a tsconfig parse, a `package.json`
	 * read, an `externalPackages` conflict check — and `String(error)` at the
	 * boundary discards the stack and any typed structure the original had,
	 * which is exactly what made these failures hard to act on when they were
	 * still untyped defects.
	 */
	readonly cause?: unknown;
}> {
	get message(): string {
		return `Config validation failed for '${this.field}': ${this.reason}`;
	}
}

const TypeRegistryErrorBase = Data.TaggedError("TypeRegistryError");

export class TypeRegistryError extends TypeRegistryErrorBase<{
	readonly packageName: string;
	readonly version: string;
	readonly reason: string;
}> {
	get message(): string {
		return `Type registry error for '${this.packageName}@${this.version}': ${this.reason}`;
	}
}
