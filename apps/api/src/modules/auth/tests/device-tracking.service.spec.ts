import { runWithRequestId } from '@api/common/request-context/request-context.util';
import { FakeTransactionRunner } from '@api/infrastructure/database/fake-transaction-runner-spec';
import { describeDevice } from '../utils/device.util';
import { DeviceTrackingService } from '../services/device-tracking.service';

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1';

describe('DeviceTrackingService', () => {
  const customer = { id: 'u-1', email: 'ada@example.com', firstName: 'Ada' };
  let tx: {
    userKnownDevice: {
      count: jest.Mock;
      createMany: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let runner: FakeTransactionRunner;
  let service: DeviceTrackingService;

  const signIn = (userAgent: string | undefined, ip = '102.89.1.1') =>
    runWithRequestId('req-device-01', () => service.recordSignIn(customer), {
      userAgent,
      ip,
    });

  beforeEach(() => {
    tx = {
      userKnownDevice: {
        count: jest.fn().mockResolvedValue(0),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    runner = new FakeTransactionRunner(tx);
    service = new DeviceTrackingService(runner as never);
    jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
  });

  it('records the first device ever seen for an account without raising an alert', async () => {
    tx.userKnownDevice.count.mockResolvedValue(0);

    await expect(signIn(CHROME_WINDOWS)).resolves.toBe(false);

    expect(tx.userKnownDevice.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: 'u-1',
          deviceHash: describeDevice(CHROME_WINDOWS).hash,
          label: 'Chrome on Windows',
          lastIp: '102.89.1.1',
        },
      ],
      skipDuplicates: true,
    });
    expect(runner.published).toHaveLength(0);
  });

  it('publishes user.login_from_new_device for a new device on an account with history', async () => {
    tx.userKnownDevice.count.mockResolvedValue(1);

    await expect(signIn(SAFARI_IPHONE)).resolves.toBe(true);

    expect(runner.runs).toEqual(['auth.record-device']);
    expect(runner.published).toEqual([
      expect.objectContaining({
        type: 'user.login_from_new_device',
        aggregate: { type: 'user', id: 'u-1' },
        actor: { type: 'user', id: 'u-1' },
        payload: expect.objectContaining({
          userId: 'u-1',
          email: 'ada@example.com',
          firstName: 'Ada',
          device: 'Safari on iOS',
          ip: '102.89.1.1',
          signedInAt: expect.any(String),
        }),
      }),
    ]);
  });

  it('only refreshes the last-seen time for a device it already knows', async () => {
    tx.userKnownDevice.count.mockResolvedValue(2);
    tx.userKnownDevice.createMany.mockResolvedValue({ count: 0 });

    await expect(signIn(CHROME_WINDOWS)).resolves.toBe(false);

    expect(tx.userKnownDevice.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'u-1',
        deviceHash: describeDevice(CHROME_WINDOWS).hash,
      },
      data: { lastSeenAt: expect.any(Date), lastIp: '102.89.1.1' },
    });
    expect(runner.published).toHaveLength(0);
  });

  it('does not alert when only the IP address changes', async () => {
    tx.userKnownDevice.count.mockResolvedValue(1);
    tx.userKnownDevice.createMany.mockResolvedValue({ count: 0 });

    await expect(signIn(CHROME_WINDOWS, '41.58.9.9')).resolves.toBe(false);
    expect(runner.published).toHaveLength(0);
  });

  it('treats a missing user agent as one unknown device, not a new one each time', async () => {
    tx.userKnownDevice.count.mockResolvedValue(1);
    tx.userKnownDevice.createMany.mockResolvedValue({ count: 0 });

    await expect(signIn(undefined)).resolves.toBe(false);
  });

  it('never fails the sign-in: a database error is logged and swallowed', async () => {
    tx.userKnownDevice.count.mockRejectedValue(new Error('db down'));

    await expect(signIn(CHROME_WINDOWS)).resolves.toBe(false);
    expect((service as any).logger.warn).toHaveBeenCalled();
  });

  it('works outside a request (no client details) as an unknown device', async () => {
    await expect(service.recordSignIn(customer)).resolves.toBe(false);
    expect(
      tx.userKnownDevice.createMany.mock.calls[0][0].data[0],
    ).toMatchObject({
      label: 'Unknown device',
      lastIp: null,
    });
  });
});
