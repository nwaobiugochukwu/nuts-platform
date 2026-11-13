const SESSION_KEY = "nuts.recommendation-session.v1";
const VISITOR_KEY = "nuts.recommendation-visitor.v1";
const VISITOR_CREATED_KEY = "nuts.recommendation-visitor-created.v1";
const VISITOR_TTL_MS = 30 * 24 * 60 * 60 * 1000;
let inMemorySessionId = "";
let inMemoryVisitorId = "";
const recommendationIdentityListeners = new Set<() => void>();

function notifyRecommendationIdentityChanged(): void {
  recommendationIdentityListeners.forEach((listener) => listener());
}

export function subscribeRecommendationIdentity(
  listener: () => void,
): () => void {
  recommendationIdentityListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (
      event.key === SESSION_KEY ||
      event.key === VISITOR_KEY ||
      event.key === VISITOR_CREATED_KEY
    ) {
      listener();
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
    const previousSessionId = getRecommendationSessionSnapshot();
    const previousVisitorId = getRecommendationVisitorSnapshot();
    getRecommendationSessionId();
    getRecommendationVisitorId();
    if (
      previousSessionId !== getRecommendationSessionSnapshot() ||
      previousVisitorId !== getRecommendationVisitorSnapshot()
    ) {
      listener();
    }
  }

  return () => {
    recommendationIdentityListeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

export function getRecommendationSessionSnapshot(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(SESSION_KEY) ?? inMemorySessionId;
  } catch {
    return inMemorySessionId;
  }
}

export function getRecommendationVisitorSnapshot(): string {
  if (typeof window === "undefined") return "";
  try {
    const id = window.localStorage.getItem(VISITOR_KEY);
    const createdAt = Number(window.localStorage.getItem(VISITOR_CREATED_KEY));
    return id && Number.isFinite(createdAt) && Date.now() - createdAt < VISITOR_TTL_MS
      ? id
      : "";
  } catch {
    return inMemoryVisitorId;
  }
}

function createSessionId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }

    const bytes = new Uint8Array(16);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
    } else {
      // Recommendation/session IDs are opaque correlation IDs, not credentials.
      // Keep the API usable in browsers that lack Web Crypto UUID support.
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch {
    return "";
  }
}

export const createRecommendationRequestId = createSessionId;

/** Returns an opaque, browser-local ID for anonymous recommendation signals. */
export function getRecommendationSessionId(): string {
  if (typeof window === "undefined") return "";

  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;

    const id = createSessionId();
    if (!id) return "";
    window.sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    if (!inMemorySessionId) inMemorySessionId = createSessionId();
    return inMemorySessionId;
  }
}

/** Starts a fresh analytics session after sign-out or an account switch. */
export function rotateRecommendationSessionId(): string {
  inMemorySessionId = "";
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // The in-memory identity below still prevents session reuse in this tab.
    }
  }
  const nextId = getRecommendationSessionId();
  notifyRecommendationIdentityChanged();
  return nextId;
}

/** Returns a short-lived browser identity used only to claim guest recent history. */
export function getRecommendationVisitorId(): string {
  if (typeof window === "undefined") return "";

  try {
    const existing = window.localStorage.getItem(VISITOR_KEY);
    const createdAt = Number(window.localStorage.getItem(VISITOR_CREATED_KEY));
    if (
      existing &&
      Number.isFinite(createdAt) &&
      Date.now() - createdAt < VISITOR_TTL_MS
    ) {
      return existing;
    }

    const id = createSessionId();
    if (!id) return "";
    window.localStorage.setItem(VISITOR_KEY, id);
    window.localStorage.setItem(VISITOR_CREATED_KEY, String(Date.now()));
    inMemoryVisitorId = id;
    return id;
  } catch {
    if (!inMemoryVisitorId) inMemoryVisitorId = createSessionId();
    return inMemoryVisitorId;
  }
}

/** Starts a fresh anonymous history after sign-out or a customer account switch. */
export function rotateRecommendationVisitorId(): string {
  inMemoryVisitorId = "";
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(VISITOR_KEY);
      window.localStorage.removeItem(VISITOR_CREATED_KEY);
    } catch {
      // The in-memory identity below still prevents history from crossing accounts in this tab.
    }
  }
  const nextId = getRecommendationVisitorId();
  notifyRecommendationIdentityChanged();
  return nextId;
}
