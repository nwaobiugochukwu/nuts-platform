import type { RecommendationAttribution } from "@/api/modules/analytics";

const STORAGE_PREFIX = "nuts.recommendation-attribution.v1:";
const ATTRIBUTION_MAX_AGE_MS = 30 * 60 * 1000;

interface StoredRecommendationAttribution {
  savedAt: number;
  attribution: RecommendationAttribution;
}

export function storeRecommendationAttribution(
  productId: string,
  attribution: RecommendationAttribution,
): void {
  if (typeof window === "undefined") return;
  try {
    const value: StoredRecommendationAttribution = { savedAt: Date.now(), attribution };
    window.sessionStorage.setItem(`${STORAGE_PREFIX}${productId}`, JSON.stringify(value));
  } catch {
    // Recommendation attribution is best-effort and must not block navigation.
  }
}

export function readRecommendationAttribution(
  productId: string,
): RecommendationAttribution | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const key = `${STORAGE_PREFIX}${productId}`;
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<StoredRecommendationAttribution>;
    const attribution = value.attribution;
    if (
      typeof value.savedAt !== "number" ||
      Date.now() - value.savedAt > ATTRIBUTION_MAX_AGE_MS ||
      !attribution ||
      typeof attribution.requestId !== "string" ||
      typeof attribution.surface !== "string" ||
      typeof attribution.rankerVersion !== "string" ||
      typeof attribution.position !== "number" ||
      typeof attribution.sessionId !== "string"
    ) {
      window.sessionStorage.removeItem(key);
      return undefined;
    }
    return attribution;
  } catch {
    return undefined;
  }
}

export function clearRecommendationAttribution(productId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(`${STORAGE_PREFIX}${productId}`);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}
