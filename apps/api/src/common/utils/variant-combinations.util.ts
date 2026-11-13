import { Prisma } from '@prisma/client';
import { VariantCombinations } from '@api/common/dto/variant-combinations.dto';

type OptionsShape =
  | { options: Prisma.JsonValue }
  | { options?: { name: string; value: string }[] };

/**
 * Given an array of variant-like objects, extracts the unique option values
 * grouped by option name. Returns an empty object when no variants exist.
 *
 * Intended usage â€” product detail responses so the frontend can build
 * filter/selctor UIs (size buttons, color swatches, etc.):
 *
 * ```ts
 * computeVariantCombinations(variants)
 * // => { size: ["S", "M", "L"], color: ["Black", "Red"] }
 * ```
 */
export function computeVariantCombinations(
  variants: OptionsShape[],
): VariantCombinations {
  const combinations: VariantCombinations = {};

  for (const variant of variants) {
    const raw = variant.options;
    if (!raw) continue;

    const options = Array.isArray(raw)
      ? raw
      : typeof raw === 'object' && raw !== null
        ? Object.entries(raw as Record<string, string>).map(
            ([name, value]) => ({
              name,
              value,
            }),
          )
        : [];

    for (const opt of options as { name: string; value: string }[]) {
      if (!opt.name || opt.value === undefined) continue;
      if (!combinations[opt.name]) {
        combinations[opt.name] = [];
      }
      if (!combinations[opt.name].includes(opt.value)) {
        combinations[opt.name].push(opt.value);
      }
    }
  }

  return combinations;
}
