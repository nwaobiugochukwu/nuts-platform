import { toNestErrors } from "@hookform/resolvers";
import type { Resolver } from "react-hook-form";
import type { ZodTypeAny } from "zod";

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
): Resolver<any> {
  return async (values, _context, options) => {
    try {
      const parsed = await schema.parseAsync(values, schemaOptions);
      return { values: parsed, errors: {} };
    } catch (error: unknown) {
      // Zod v4 uses `.issues`; Zod v3 used `.errors`
      const issues =
        (error as any)?.issues ?? (error as any)?.errors;

      if (Array.isArray(issues)) {
        const flatErrors: Record<string, { message: string; type: string }> =
          {};
        for (const issue of issues) {
          const path = (issue.path as (string | number)[]).join(".");
          if (!flatErrors[path]) {
            flatErrors[path] = {
              message: issue.message as string,
              type: issue.code as string,
            };
          }
        }
        return { values: {}, errors: toNestErrors(flatErrors, options) };
      }

      throw error;
    }
  };
}
