/**
 * Highest percentage a VENDOR may give on its own code. Vendor discounts are
 * vendor-funded (deducted from that vendor's earnings), but an unbounded
 * percentage still lets a vendor run a 100%-off code, so it is capped here.
 * Admin/platform codes are not subject to this cap (they may go to 100%).
 */
export const VENDOR_MAX_DISCOUNT_PERCENT = 50;

/** Canonical discount code format: 3-50 chars, A-Z 0-9 underscore hyphen. */
export const DISCOUNT_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,49}$/;

/** Upper bound for product/category id lists on a single code. */
export const DISCOUNT_MAX_LIST_ITEMS = 100;
