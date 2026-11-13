import { ServiceUnavailableException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CacheService } from '@api/infrastructure/cache/cache.service';
import { MaintenanceModeMiddleware } from './maintenance-mode.middleware';

describe('MaintenanceModeMiddleware', () => {
  let middleware: MaintenanceModeMiddleware;
  let cache: { get: jest.Mock };
  let next: jest.Mock;

  const mockRes = {} as Response;

  beforeEach(() => {
    cache = {
      get: jest.fn(),
    };
    middleware = new MaintenanceModeMiddleware(
      cache as unknown as CacheService,
    );
    next = jest.fn();
  });

  it('bypasses OPTIONS requests without checking cache', async () => {
    const req = { method: 'OPTIONS', path: '/api/v1/products' } as Request;
    await middleware.use(req, mockRes, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(cache.get).not.toHaveBeenCalled();
  });

  it('bypasses /api/v1/auth/admin routes without checking cache', async () => {
    const req = { method: 'POST', path: '/api/v1/auth/admin/login' } as Request;
    await middleware.use(req, mockRes, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(cache.get).not.toHaveBeenCalled();
  });

  it('bypasses /api/v1/health probe routes', async () => {
    const req = { method: 'GET', path: '/api/v1/health' } as Request;
    await middleware.use(req, mockRes, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(cache.get).not.toHaveBeenCalled();
  });

  it('calls next() when maintenanceMode is false', async () => {
    const req = { method: 'GET', path: '/api/v1/products' } as Request;
    cache.get.mockResolvedValue({ maintenanceMode: false });

    await middleware.use(req, mockRes, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('throws ServiceUnavailableException (503) when maintenanceMode is true', async () => {
    const req = { method: 'GET', path: '/api/v1/products' } as Request;
    cache.get.mockResolvedValue({
      maintenanceMode: true,
      announcement: 'Scheduled database upgrade in progress.',
    });

    await expect(middleware.use(req, mockRes, next)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('fails open when cache read errors', async () => {
    const req = { method: 'GET', path: '/api/v1/products' } as Request;
    cache.get.mockRejectedValue(new Error('Redis timeout'));

    await middleware.use(req, mockRes, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
