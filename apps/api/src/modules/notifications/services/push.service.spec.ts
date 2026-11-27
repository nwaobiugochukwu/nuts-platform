import { ConfigService } from '@nestjs/config';
import { ROLE } from '@prisma/client';
import { WebPushService } from './push.service';

describe('WebPushService', () => {
  let service: WebPushService;
  let prisma: {
    pushSubscription: {
      findMany: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let config: {
    get: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      pushSubscription: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    config = {
      get: jest.fn((key: string) => {
        if (key === 'VAPID_PUBLIC_KEY')
          return 'BG7iC_hNvLZ6zu3e1sFiAHxIypBSkQuQYhD0LmJX4T0lRoQHQjkToLROdPvbxc32U9rxXkHK5WWsmNHWK6a8r1k';
        if (key === 'VAPID_PRIVATE_KEY')
          return 'hDRgKdkos7QGXKrK_DrNhlpft0mi60EjJBNi_pDQ3Zw';
        return 'mailto:ugochukwutemitayo@gmail.com';
      }),
    };
    service = new WebPushService(
      prisma as never,
      config as unknown as ConfigService,
    );
  });

  it('runs safely in no-op mode if no subscriptions exist', async () => {
    service.onModuleInit();
    const count = await service.sendToUser('user-1', ROLE.USER, {
      title: 'Test',
      body: 'Message',
    });
    expect(count).toBe(0);
    expect(prisma.pushSubscription.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', role: ROLE.USER },
    });
  });
});
