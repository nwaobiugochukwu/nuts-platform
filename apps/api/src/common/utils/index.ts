export function calculateExponentialBackoff(
  attempt: number,
  baseDelayMs: number = 1000,
  maxDelayMs: number = 30000,
): number {
  const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
  return Math.round(delay + Math.random() * delay * 0.1); // jitter
}

export function generateJobId(prefix: string, ...parts: string[]): string {
  return `${prefix}:${parts.join(':')}`;
}

export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export function toDecimal(value: number): number {
  return Math.round(value * 100) / 100;
}
