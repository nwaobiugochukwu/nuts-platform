import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { QueryAdminVendorsDto } from './query-admin-vendors.dto';

describe('QueryAdminVendorsDto', () => {
  it('transforms false query strings to false for every boolean filter', () => {
    const query = plainToInstance(QueryAdminVendorsDto, {
      isActive: 'false',
      isApproved: 'false',
      isVerified: 'false',
    });

    expect(query.isActive).toBe(false);
    expect(query.isApproved).toBe(false);
    expect(query.isVerified).toBe(false);
    expect(validateSync(query)).toEqual([]);
  });

  it('transforms true query strings to true for every boolean filter', () => {
    const query = plainToInstance(QueryAdminVendorsDto, {
      isActive: 'true',
      isApproved: 'true',
      isVerified: 'true',
    });

    expect(query.isActive).toBe(true);
    expect(query.isApproved).toBe(true);
    expect(query.isVerified).toBe(true);
    expect(validateSync(query)).toEqual([]);
  });
});
