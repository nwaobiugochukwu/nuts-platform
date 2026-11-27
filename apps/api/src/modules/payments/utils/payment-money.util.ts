import { Prisma } from '@prisma/client';

/** Paystack amounts are in the smallest unit (kobo): the decimal amount times 100. */
export function toPaystackAmount(amount: Prisma.Decimal): number {
  return Number(amount.toDecimalPlaces(2).mul(100));
}

/** True when a number from a request equals a stored decimal exactly. */
export function moneyEquals(value: number, decimal: Prisma.Decimal): boolean {
  if (!Number.isFinite(value)) {
    return false;
  }

  return new Prisma.Decimal(value).equals(decimal);
}
