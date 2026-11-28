/**
 * One id per intended action, so sending the same action twice (a double click, a retry after a lost
 * response) is recognised by the server and applied once.
 *
 * The id belongs to the *intent*, not to the click: asking for the same thing again reuses the id,
 * asking for something different gets a new one. Call `done()` when the action has been carried out,
 * so the next identical request is a new action rather than a repeat.
 */
export function createIntentIds(newId: () => string = randomId) {
  let current: { key: string; id: string } | null = null;
  return {
    /** The id for this intent: the same while the intent is unchanged, a new one when it changes. */
    forIntent(key: string): string {
      if (!current || current.key !== key) current = { key, id: newId() };
      return current.id;
    },
    /** The action succeeded: the next request, even an identical one, is a new action. */
    done(): void {
      current = null;
    },
  };
}

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Only reached in very old browsers; still a valid version 4 UUID.
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
