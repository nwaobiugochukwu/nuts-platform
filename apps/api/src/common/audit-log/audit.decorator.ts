import { SetMetadata } from '@nestjs/common';

/** What an `@Audit` resolver can see about the finished request. */
export interface AuditContext {
  params: Record<string, string | string[]>;
  query: Record<string, unknown>;
  body: unknown;
  /** The value the handler returned (undefined for failures). */
  result: unknown;
  user?: { id: string; role: string; email?: string };
}

export interface AuditOptions {
  /** Stable action name, e.g. `PRODUCT_UPDATED`. */
  action: string;
  /** Entity type, e.g. `Product`. */
  entity: string;
  /** The entity id: a route param name, or a function of the finished request. */
  entityId?: string | ((ctx: AuditContext) => string | undefined);
  /** Defaults to the redacted route params and body. */
  payload?: (ctx: AuditContext) => unknown;
  /** Stored as the "after" state (for example a field of the result). */
  after?: (ctx: AuditContext) => unknown;
  /**
   * Also record failures: 4xx responses that carry a status code. Use for
   * security-relevant endpoints (sign-in, permission changes).
   */
  onFailure?: boolean;
}

export const AUDIT_METADATA = 'nuts:audit';

/**
 * Records an audit event AFTER the handler succeeds (2xx), without making the
 * request wait for it. For changes that must never be lost (money, permissions),
 * use `TransactionContext.audit(...)` inside the transaction instead.
 */
export const Audit = (options: AuditOptions): MethodDecorator =>
  SetMetadata(AUDIT_METADATA, options);
