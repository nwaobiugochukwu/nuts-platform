import {
  currentRequestContext,
  type AuditAnnotation,
  type AuditExtraEvent,
} from '@api/common/request-context/request-context';

/**
 * Attaches details to the audit event of the request being served.
 *
 * The controller method says WHAT happened with `@Audit({ action, entity })`;
 * the service, which knows the specifics (the id of the record it just created,
 * the old and new values), calls this instead of writing to the audit log itself.
 * The audit interceptor merges everything into one event after the response, so
 * the request never waits for it. Several calls in one request are merged
 * (`payload` keys are combined, other fields take the latest value).
 *
 * Outside a request (a scheduled job, a queue consumer) there is nothing to
 * attach to and this does nothing; such code records its own event with
 * `AuditLogService.record`.
 */
export function auditDetails(details: AuditAnnotation): void {
  const context = currentRequestContext();
  if (!context) return;
  const current = context.audit ?? {};
  context.audit = {
    ...current,
    ...details,
    payload:
      current.payload || details.payload
        ? { ...current.payload, ...details.payload }
        : undefined,
  };
}

/**
 * Records one more event in the same request, next to the main one named by
 * `@Audit` (for example the automatic unsuspend that happens while a user signs
 * in). Like `auditDetails`, it does nothing outside a request.
 */
export function auditAlso(event: AuditExtraEvent): void {
  const context = currentRequestContext();
  if (!context) return;
  context.audit = {
    ...context.audit,
    extra: [...(context.audit?.extra ?? []), event],
  };
}

/** What `auditDetails` collected for the current request. */
export function currentAuditDetails(): AuditAnnotation | undefined {
  return currentRequestContext()?.audit;
}
