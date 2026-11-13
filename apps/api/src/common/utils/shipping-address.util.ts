export interface AddressLike {
  receiverName: string;
  street: string;
  city: string;
  state: string;
  country: string;
  phone: string;
  postalCode?: string | null;
}

/**
 * Formats a shipping address object into a standard string representation.
 */
export function formatShippingAddress(address: AddressLike): string {
  const parts = [
    address.receiverName,
    address.street,
    address.city,
    address.state,
    address.postalCode,
    address.country,
  ].filter(Boolean);

  return `${parts.join(', ')} (Tel: ${address.phone})`;
}
