import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { QueryProductDto } from './query-product.dto';

describe('QueryProductDto boolean query parameters', () => {
  it.each([
    ['true', true],
    ['false', false],
    ['1', true],
    ['0', false],
    ['yes', true],
    ['no', false],
  ])(
    'transforms isActive=%s to %s with implicit conversion enabled',
    (input, expected) => {
      const query = plainToInstance(
        QueryProductDto,
        { isActive: input },
        { enableImplicitConversion: true },
      );

      expect(query.isActive).toBe(expected);
      expect(validateSync(query)).toHaveLength(0);
    },
  );
});
