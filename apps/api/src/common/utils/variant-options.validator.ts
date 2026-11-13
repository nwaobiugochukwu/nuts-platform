import { BadRequestException } from '@nestjs/common';

/**
 * Represents a single variant option pair.
 */
export interface VariantOption {
  name: string;
  value: string;
}

/**
 * Represents a variant's options as an array of {name, value} pairs.
 * Example: [{ name: "size", value: "M" }, { name: "color", value: "Black" }]
 */
export type VariantOptions = VariantOption[];

/**
 * Normalizes variant options from DB to the canonical array format.
 * Handles both:
 * - New format: [{ name: "size", value: "M" }]
 * - Legacy format: { size: "M", color: "Black" }
 */
export function normalizeOptions(options: unknown): VariantOptions {
  if (!options) return [];
  if (Array.isArray(options)) {
    return options as VariantOptions;
  }
  if (typeof options === 'object') {
    return Object.entries(options as Record<string, string>).map(
      ([name, value]) => ({ name, value }),
    );
  }
  return [];
}

/**
 * Checks whether two variant option arrays are equal.
 */
export function areOptionsEqual(a: VariantOptions, b: VariantOptions): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((x, y) => x.name.localeCompare(y.name));
  const sortedB = [...b].sort((x, y) => x.name.localeCompare(y.name));
  return sortedA.every(
    (opt, i) => opt.name === sortedB[i].name && opt.value === sortedB[i].value,
  );
}

/**
 * Serialises variant options to a canonical string for comparison.
 * Sorts by name to ensure deterministic output.
 * Excludes stock from comparison since stock doesn't define option identity.
 */
export function canonicalizeOptions(options: VariantOptions): string {
  return JSON.stringify(
    [...options]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ name, value }) => ({ name, value })),
  );
}

/**
 * Validates that a set of new variant options does not duplicate existing ones.
 *
 * @param newOptions  - The variant options to check (array format).
 * @param existingOptions - The existing variant options from DB (object or array format).
 * @param excludeVariantId - Optional variant ID to exclude from the check (when updating).
 * @throws BadRequestException if a duplicate is found.
 */
export function assertNoDuplicateVariantOptions(
  newOptions: VariantOptions,
  existingOptions: unknown[],
  excludeVariantId?: string,
): void {
  const canonicalNew = canonicalizeOptions(newOptions);

  const isDuplicate = existingOptions.some((existing) => {
    if (
      excludeVariantId &&
      (existing as { id?: string }).id === excludeVariantId
    ) {
      return false;
    }
    return canonicalizeOptions(normalizeOptions(existing)) === canonicalNew;
  });

  if (isDuplicate) {
    throw new BadRequestException(
      `A variant with the options ${JSON.stringify(newOptions)} already exists for this product.`,
    );
  }
}

/**
 * Validates that no two items in an array of variant options are duplicates.
 *
 * @param optionsArray - Array of variant options to validate (array format).
 * @throws BadRequestException if duplicates are found.
 */
export function assertNoDuplicateOptionsInArray(
  optionsArray: VariantOptions[],
): void {
  const seen = new Set<string>();

  for (const opts of optionsArray) {
    const canonical = canonicalizeOptions(opts);
    if (seen.has(canonical)) {
      throw new BadRequestException(
        `Duplicate variant options detected: ${JSON.stringify(opts)}. Each variant must have a unique combination of options.`,
      );
    }
    seen.add(canonical);
  }
}

/**
 * Validates that variant options array only contains valid {name, value} pairs.
 *
 * @param options - The variant options to validate.
 * @throws BadRequestException if any value is not a string.
 */
export function assertValidVariantOptions(options: unknown): void {
  if (!Array.isArray(options)) {
    throw new BadRequestException(
      'Variant options must be an array of {name, value} pairs.',
    );
  }

  if (options.length === 0) {
    throw new BadRequestException(
      'Variant options must have at least one option pair.',
    );
  }

  for (const item of options) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new BadRequestException(
        'Each variant option must be a valid {name, value} object.',
      );
    }
    const opt = item as Record<string, unknown>;
    if (typeof opt.name !== 'string' || opt.name.trim().length === 0) {
      throw new BadRequestException(
        'Variant option name must be a non-empty string.',
      );
    }
    if (typeof opt.value !== 'string') {
      throw new BadRequestException('Variant option value must be a string.');
    }
  }
}
