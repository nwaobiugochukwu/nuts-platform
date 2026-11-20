import { toNestErrors } from "@hookform/resolvers";
import type {
  FieldValues,
  ResolverOptions,
  ResolverResult,
} from "react-hook-form";
import type { ZodTypeAny } from "zod";

type FlexibleResolver = <TFieldValues extends FieldValues>(
  values: TFieldValues,
  context: unknown,
  options: ResolverOptions<TFieldValues>,
) => Promise<ResolverResult<TFieldValues>>;

/**
 * Custom zodResolver compatible with both Zod v3 and Zod v4.
 *
 * The official `@hookform/resolvers/zod` v3.x checks `Array.isArray(e.errors)`
 * to detect a ZodError. In Zod v4 the property was renamed to `.issues`, so the
 * resolver fails to recognise the error and re-throws it as an unhandled
 * rejection.  This wrapper handles both `.issues` (v4) and `.errors` (v3).
 */
export function zodResolver<T extends ZodTypeAny>(
  schema: T,
  schemaOptions?: Parameters<T["parseAsync"]>[1],
): FlexibleResolver {
  return async <TFieldValues extends FieldValues>(
    values: TFieldValues,
    _context: unknown,
    options: ResolverOptions<TFieldValues>,
  ): Promise<ResolverResult<TFieldValues>> => {
    try {
      const parsed = await schema.parseAsync(values, schemaOptions);
      return { values: parsed as TFieldValues, errors: {} };
    } catch (error: unknown) {
      // Zod v4 uses `.issues`; Zod v3 used `.errors`
      const errorRecord =
        typeof error === "object" && error !== null
          ? (error as Record<string, unknown>)
          : null;
      const issues = errorRecord?.issues ?? errorRecord?.errors;

      if (Array.isArray(issues)) {
        const flatErrors: Record<string, { message: string; type: string }> =
          {};
        for (const issue of issues) {
          if (typeof issue !== "object" || issue === null) continue;
          const candidate = issue as {
            path?: unknown;
            message?: unknown;
            code?: unknown;
          };
          if (!Array.isArray(candidate.path)) continue;
          const path = candidate.path.join(".");
          if (!flatErrors[path]) {
            flatErrors[path] = {
              message:
                typeof candidate.message === "string" ? candidate.message : "Invalid value",
              type: typeof candidate.code === "string" ? candidate.code : "custom",
            };
          }
        }
        return { values: {}, errors: toNestErrors(flatErrors, options) };
      }

      throw error;
    }
  };
}
