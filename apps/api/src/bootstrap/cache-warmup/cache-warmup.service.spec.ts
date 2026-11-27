import { CategoriesService } from '@api/modules/categories/categories.service';
import { DiscountCodeService } from '@api/modules/discounts/discount-code.service';
import { ProductsService } from '@api/modules/products/products.service';
import { VendorsService } from '@api/modules/vendors/vendors.service';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { CacheWarmupService } from './cache-warmup.service';

function build(overrides: { discoveryFails?: boolean } = {}) {
  const calls: string[] = [];
  const stubs = new Map<unknown, unknown>([
    [
      CategoriesService,
      {
        getTree: jest.fn(() => {
          calls.push('categories');
          return Promise.resolve();
        }),
      },
    ],
    [
      DiscountCodeService,
      {
        getPublicPlatformPromos: jest.fn(() => {
          calls.push('campaigns');
          return Promise.resolve();
        }),
      },
    ],
    [
      VendorsService,
      {
        findFeaturedPublicVendors: jest.fn(() => {
          calls.push('vendors');
          return Promise.resolve();
        }),
      },
    ],
    [
      ProductsService,
      {
        findAllPublicCursor: jest.fn(() => {
          if (overrides.discoveryFails)
            return Promise.reject(new Error('db down'));
          calls.push('discover');
          return Promise.resolve();
        }),
      },
    ],
  ]);
  const moduleRef = {
    get: (token: unknown) => stubs.get(token),
  } as unknown as ModuleRef;
  const config = {
    get: (key: string, fallback?: string) =>
      key === 'NODE_ENV' ? 'test' : (fallback ?? undefined),
  } as unknown as ConfigService;
  return { service: new CacheWarmupService(moduleRef, config), calls };
}

describe('CacheWarmupService', () => {
  it('runs the same service calls the public routes use', async () => {
    const { service, calls } = build();
    await service.warm();
    expect(calls).toEqual(['categories', 'campaigns', 'vendors', 'discover']);
  });

  it('a failing step is skipped and the rest still run', async () => {
    const { service, calls } = build({ discoveryFails: true });
    await expect(service.warm()).resolves.toBeUndefined();
    expect(calls).toEqual(['categories', 'campaigns', 'vendors']);
  });

  it('does nothing when NODE_ENV is test', () => {
    jest.useFakeTimers();
    const { service, calls } = build();
    service.onApplicationBootstrap();
    jest.advanceTimersByTime(10_000);
    expect(calls).toEqual([]);
    jest.useRealTimers();
  });
});
