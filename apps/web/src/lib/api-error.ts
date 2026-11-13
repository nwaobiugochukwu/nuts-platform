function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (!isRecord(error) || !isRecord(error.response)) return fallback;
  if (!isRecord(error.response.data)) return fallback;

  const message = error.response.data.message;
  if (typeof message === "string") return message;
  if (Array.isArray(message)) {
    const parts = message.filter((item): item is string => typeof item === "string");
    if (parts.length > 0) return parts.join(", ");
  }

  return fallback;
}
