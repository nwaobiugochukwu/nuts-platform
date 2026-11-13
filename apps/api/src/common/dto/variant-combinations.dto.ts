/**
 * Maps each option name (e.g. "size", "color") to an array of
 * unique available values across all active variants.
 *
 * Example:
 * ```
 * { size: ["S", "M", "L"], color: ["Black", "Red"] }
 * ```
 */
export type VariantCombinations = Record<string, string[]>;
