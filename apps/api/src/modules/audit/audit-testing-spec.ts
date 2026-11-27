import { runWithRequestId } from '@api/common/request-context/request-context.util';
import type { AuditAnnotation } from '@api/common/request-context/request-context.util';
import { currentAuditDetails } from './utils/audit-details.util';

/**
 * Test helper: runs `fn` as if inside a request and returns what the service
 * attached with `auditDetails(...)`, so specs can assert on the audit trail
 * without a real request, interceptor or queue.
 */
export async function captureAudit<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; details: AuditAnnotation | undefined }> {
  return runWithRequestId('req-test-capture', async () => {
    const result = await fn();
    return { result, details: currentAuditDetails() };
  });
}
