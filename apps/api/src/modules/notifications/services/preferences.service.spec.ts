import { ROLE } from '@prisma/client';
import { NotificationPreferencesService } from './preferences.service';

describe('NotificationPreferencesService', () => {
  let service: NotificationPreferencesService;
  let prisma: {
    notificationPreference: {
      findUnique: jest.Mock;
      create: jest.Mock;
      upsert: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      notificationPreference: {
        findUnique: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn(),
      },
    };
    service = new NotificationPreferencesService(prisma as never);
  });

  it('always allows securityAlerts regardless of preferences', async () => {
    const allowed = await service.canSend(
      'user-1',
      ROLE.USER,
      'email',
      'securityAlerts',
    );
    expect(allowed).toBe(true);
    expect(prisma.notificationPreference.findUnique).not.toHaveBeenCalled();
  });

  it('returns false when channel is disabled in user preferences', async () => {
    prisma.notificationPreference.findUnique.mockResolvedValue({
      emailEnabled: false,
      inAppEnabled: true,
      pushEnabled: true,
      orderUpdates: true,
      paymentAlerts: true,
      inventoryAlerts: true,
      marketingPromos: false,
    });

    const allowed = await service.canSend(
      'user-1',
      ROLE.USER,
      'email',
      'orderUpdates',
    );
    expect(allowed).toBe(false);
  });

  it('returns false when category is opted out in user preferences', async () => {
    prisma.notificationPreference.findUnique.mockResolvedValue({
      emailEnabled: true,
      inAppEnabled: true,
      pushEnabled: true,
      orderUpdates: true,
      paymentAlerts: true,
      inventoryAlerts: true,
      marketingPromos: false,
    });

    const allowed = await service.canSend(
      'user-1',
      ROLE.USER,
      'push',
      'marketingPromos',
    );
    expect(allowed).toBe(false);
  });

  it('creates default preferences when none exist', async () => {
    prisma.notificationPreference.findUnique.mockResolvedValue(null);
    prisma.notificationPreference.create.mockResolvedValue({
      userId: 'user-1',
      role: ROLE.USER,
      emailEnabled: true,
      inAppEnabled: true,
      pushEnabled: true,
      orderUpdates: true,
      paymentAlerts: true,
      inventoryAlerts: true,
      marketingPromos: false,
    });

    const prefs = await service.getPreferences('user-1', ROLE.USER);
    expect(prefs.marketingPromos).toBe(false);
    expect(prisma.notificationPreference.create).toHaveBeenCalled();
  });
});
