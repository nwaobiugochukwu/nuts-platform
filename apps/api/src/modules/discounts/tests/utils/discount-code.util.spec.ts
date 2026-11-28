import { DiscountCodeScope, DiscountCodeType, Prisma } from '@prisma/client';
import {
  normalizeDiscountCode,
  toDiscountResponseDto,
} from '../../utils/discount-code.util';

describe('normalizeDiscountCode', () => {
  it('makes codes case- and space-insensitive, so SAVE10, save10 and " Save10 " are one code', () => {
    expect(normalizeDiscountCode('SAVE10')).toBe('SAVE10');
    expect(normalizeDiscountCode('save10')).toBe('SAVE10');
    expect(normalizeDiscountCode('  Save10 ')).toBe('SAVE10');
  });
});

describe('toDiscountResponseDto', () => {
  it('turns decimals into numbers and keeps the code’s identity and scope', () => {
    const dto = toDiscountResponseDto({
      id: 'dc1',
      code: 'SAVE20',
      type: DiscountCodeType.PERCENTAGE,
      value: new Prisma.Decimal(20),
      scope: DiscountCodeScope.PLATFORM,
      minOrderAmount: new Prisma.Decimal(10000),
      maxDiscountAmount: null,
    } as never);

    expect(dto).toMatchObject({
      id: 'dc1',
      code: 'SAVE20',
      type: DiscountCodeType.PERCENTAGE,
      value: 20,
      scope: DiscountCodeScope.PLATFORM,
    });
  });
});
