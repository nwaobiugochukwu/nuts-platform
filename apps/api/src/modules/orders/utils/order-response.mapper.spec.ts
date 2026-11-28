import {
  normalizeVariantSnapshot,
  toAppliedVouchers,
  variantLabel,
} from './order-response.mapper';

describe('variantLabel', () => {
  it('joins name/value options in order', () => {
    expect(
      variantLabel([
        { name: 'Size', value: 'M' },
        { name: 'Colour', value: 'Red' },
      ]),
    ).toBe('Size: M, Colour: Red');
  });

  it('reads options stored as an object', () => {
    expect(variantLabel({ Size: 'M', Pairs: 2 })).toBe('Size: M, Pairs: 2');
  });

  it('keeps an option that is not name/value, as text', () => {
    expect(variantLabel(['plain', { odd: true }])).toBe('plain, {"odd":true}');
  });

  it('has no label when there are no options', () => {
    expect(variantLabel(null)).toBeNull();
    expect(variantLabel('text')).toBeNull();
  });
});

describe('normalizeVariantSnapshot', () => {
  it('keeps only well-formed options from a list', () => {
    expect(
      normalizeVariantSnapshot([
        { name: 'Size', value: 'M' },
        { name: 'Bad' },
        'junk',
      ]),
    ).toEqual({ options: [{ name: 'Size', value: 'M' }] });
  });

  it('turns an object into options', () => {
    expect(normalizeVariantSnapshot({ Size: 'M', Pairs: 2 })).toEqual({
      options: [
        { name: 'Size', value: 'M' },
        { name: 'Pairs', value: '2' },
      ],
    });
  });

  it('is null for nothing, or for something that is not a snapshot', () => {
    expect(normalizeVariantSnapshot(null)).toBeNull();
    expect(normalizeVariantSnapshot(undefined)).toBeNull();
    expect(normalizeVariantSnapshot('x')).toBeNull();
  });
});

describe('toAppliedVouchers', () => {
  it('lists what each voucher took off, from the stored usages', () => {
    const order = {
      discountCode: 'IGNORED',
      discountCodeUsages: [
        {
          discountAmount: '500',
          discountCode: {
            code: 'STORE20',
            description: null,
            scope: 'VENDOR',
            type: 'PERCENTAGE',
            value: '20',
            autoApply: true,
          },
        },
      ],
    };

    expect(toAppliedVouchers(order as never)).toEqual([
      {
        code: 'STORE20',
        description: null,
        scope: 'VENDOR',
        type: 'PERCENTAGE',
        value: 20,
        amount: 500,
        automatic: true,
      },
    ]);
  });

  it('reads an old order that only kept the joined code string', () => {
    const vouchers = toAppliedVouchers({
      discountCode: 'STORE20, PLAT10 ,',
      discountCodeUsages: [],
    } as never);

    expect(vouchers.map((v) => v.code)).toEqual(['STORE20', 'PLAT10']);
    expect(vouchers[0]).toMatchObject({ amount: null, automatic: false });
  });

  it('has none for a list row that does not carry usages and had no code', () => {
    expect(toAppliedVouchers({ discountCode: null } as never)).toEqual([]);
  });
});
