import { ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CacheService } from '@api/infrastructure/cache/cache.service';
import { RegistrationsGuard } from './registrations.guard';

describe('RegistrationsGuard', () => {
  let guard: RegistrationsGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let cache: { get: jest.Mock };

  const mockContext = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
  } as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    };
    cache = {
      get: jest.fn(),
    };
    guard = new RegistrationsGuard(
      reflector as unknown as Reflector,
      cache as unknown as CacheService,
    );
  });

  it('allows request when no registration decorator is present', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    const result = await guard.canActivate(mockContext);
    expect(result).toBe(true);
    expect(cache.get).not.toHaveBeenCalled();
  });

  it('allows user registration when allowRegistrations is true', async () => {
    reflector.getAllAndOverride.mockReturnValue('user');
    cache.get.mockResolvedValue({
      allowRegistrations: true,
      allowVendorRegistrations: true,
    });

    const result = await guard.canActivate(mockContext);
    expect(result).toBe(true);
  });

  it('throws ServiceUnavailableException when user registration is disabled', async () => {
    reflector.getAllAndOverride.mockReturnValue('user');
    cache.get.mockResolvedValue({
      allowRegistrations: false,
      allowVendorRegistrations: true,
    });

    await expect(guard.canActivate(mockContext)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('allows vendor registration when allowVendorRegistrations is true', async () => {
    reflector.getAllAndOverride.mockReturnValue('vendor');
    cache.get.mockResolvedValue({
      allowRegistrations: false,
      allowVendorRegistrations: true,
    });

    const result = await guard.canActivate(mockContext);
    expect(result).toBe(true);
  });

  it('throws ServiceUnavailableException when vendor registration is disabled', async () => {
    reflector.getAllAndOverride.mockReturnValue('vendor');
    cache.get.mockResolvedValue({
      allowRegistrations: true,
      allowVendorRegistrations: false,
    });

    await expect(guard.canActivate(mockContext)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('fails open when cache read errors', async () => {
    reflector.getAllAndOverride.mockReturnValue('user');
    cache.get.mockRejectedValue(new Error('Redis connection lost'));

    const result = await guard.canActivate(mockContext);
    expect(result).toBe(true);
  });

  it('fails open when no config is cached yet', async () => {
    reflector.getAllAndOverride.mockReturnValue('vendor');
    cache.get.mockResolvedValue(undefined);

    const result = await guard.canActivate(mockContext);
    expect(result).toBe(true);
  });
});
