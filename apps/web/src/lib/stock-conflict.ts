export interface StockConflictItem {
  productId: string;
  variantId: string | null;
  name: string;
  variantLabel: string | null;
  requested: number;
  available: number;
}

export interface StockConflictPayload {
  message: string;
  items: StockConflictItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Checks if an API error represents an INSUFFICIENT_STOCK conflict (HTTP 409).
 * Returns the parsed payload containing the affected items and available stock counts.
 */
export function extractStockConflict(error: unknown): StockConflictPayload | null {
  if (!isRecord(error)) return null;

  // Handle Axios-style response envelope
  const response = isRecord(error.response) ? error.response : null;
  const data = response && isRecord(response.data) ? response.data : isRecord(error.data) ? error.data : null;

  if (!data) return null;

  const errorObj = isRecord(data.error) ? data.error : null;
  const code = (errorObj?.code as string | undefined) || (data.code as string | undefined);

  if (code !== "INSUFFICIENT_STOCK") return null;

  const message =
    typeof data.message === "string"
      ? data.message
      : "Some items in your cart are no longer available in the requested quantity.";

  const meta = isRecord(errorObj?.meta) ? errorObj.meta : isRecord(data.meta) ? data.meta : null;
  const rawItems = Array.isArray(meta?.items) ? meta.items : [];

  const items: StockConflictItem[] = rawItems
    .filter(isRecord)
    .map((item) => ({
      productId: String(item.productId || ""),
      variantId: item.variantId ? String(item.variantId) : null,
      name: String(item.name || "Product"),
      variantLabel: item.variantLabel ? String(item.variantLabel) : null,
      requested: Number(item.requested || 1),
      available: Math.max(0, Number(item.available || 0)),
    }));

  return {
    message,
    items,
  };
}
