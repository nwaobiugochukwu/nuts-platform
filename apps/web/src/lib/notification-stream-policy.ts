export const MAX_NOTIFICATION_STREAM_FAILURES = 3;

export function shouldRetryNotificationStream(failureCount: number): boolean {
  return failureCount < MAX_NOTIFICATION_STREAM_FAILURES;
}

export function shouldRetryNotificationHttpStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status !== 502);
}
