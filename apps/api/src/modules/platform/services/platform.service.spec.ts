import { PlatformService } from './platform.service';
import { captureAudit } from '@api/modules/audit/audit-testing-spec';

describe('PlatformService', () => {
  let service: PlatformService;
  let mockPrisma: any;
  let mockCache: any;

  beforeEach(() => {
    mockPrisma = {
      user: { count: jest.fn().mockResolvedValue(100) },
      vendor: { count: jest.fn().mockResolvedValue(20) },
      product: { count: jest.fn().mockResolvedValue(500) },
      order: { count: jest.fn().mockResolvedValue(150) },
    };

    mockCache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };

    service = new PlatformService(mockPrisma, mockCache);
  });

  describe('platform config', () => {
    it('returns default config when cache is empty', async () => {
      mockCache.get.mockResolvedValue(null);

      const config = await service.getPlatformConfig();

      expect(config.maintenanceMode).toBe(false);
      expect(config.allowRegistrations).toBe(true);
      expect(mockCache.set).toHaveBeenCalled();
    });

    it('updates platform config and writes audit log', async () => {
      mockCache.get.mockResolvedValue({
        maintenanceMode: false,
        announcement: null,
        allowRegistrations: true,
        allowVendorRegistrations: true,
        updatedAt: new Date(),
      });

      const { result: updated, details: configDetails } = await captureAudit(
        () =>
          service.updatePlatformConfig({
            maintenanceMode: true,
            announcement: 'Maintenance in progress',
          }),
      );

      expect(updated.maintenanceMode).toBe(true);
      expect(updated.announcement).toBe('Maintenance in progress');
      expect(configDetails?.payload).toHaveProperty('previous');
      expect(configDetails?.payload).toHaveProperty('updated');
    });
  });

  describe('getSystemOverview()', () => {
    it('returns platform overview metrics', async () => {
      const overview = await service.getSystemOverview();

      expect(overview.usersCount).toBe(100);
      expect(overview.vendorsCount).toBe(20);
      expect(overview.productsCount).toBe(500);
      expect(overview.ordersCount).toBe(150);
    });
  });
});
