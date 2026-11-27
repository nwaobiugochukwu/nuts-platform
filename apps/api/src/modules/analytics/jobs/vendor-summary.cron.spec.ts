import { NotificationType, ROLE } from '@prisma/client';
import { generateJobId } from '@api/common/utils';
import { RABBITMQ_QUEUES } from '@api/infrastructure/rabbitmq/rabbitmq.constants';
import { VendorSummaryCron } from './vendor-summary.cron';

describe('VendorSummaryCron', () => {
  let prisma: { $queryRaw: jest.Mock; vendor: { findMany: jest.Mock } };
  let rabbitmq: { publish: jest.Mock };
  let templates: { weeklyVendorSummary: jest.Mock };
  let redis: { get: jest.Mock; set: jest.Mock };
  let cron: VendorSummaryCron;
  const weekStartStr = '2026-11-20';

  const row = (overrides: Record<string, unknown> = {}) => ({
    vendorId: 'vendor-1',
    revenue: '50000',
    ordersCount: '4',
    productName: 'Red Shoe',
    totalSold: '6',
    productRevenue: '30000',
    ...overrides,
  });

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-27T08:00:00.000Z'));
    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      vendor: { findMany: jest.fn().mockResolvedValue([]) },
    };
    rabbitmq = { publish: jest.fn().mockResolvedValue(true) };
    templates = {
      weeklyVendorSummary: jest.fn().mockReturnValue('<html>summary</html>'),
    };
    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    };
    cron = new VendorSummaryCron(
      prisma as never,
      rabbitmq as never,
      templates as never,
      redis as never,
    );
    for (const level of ['log', 'warn', 'error'] as const) {
      jest
        .spyOn((cron as any).logger, level)
        .mockImplementation(() => undefined);
    }
  });

  afterEach(() => jest.useRealTimers());

  const approvedVendor = (overrides: Record<string, unknown> = {}) => ({
    id: 'vendor-1',
    email: 'v@shop.com',
    storeName: 'Shop',
    vendorWallet: { pendingBalance: '1200', balance: '8800' },
    ...overrides,
  });

  it('reports no activity and sends nothing when no vendor sold anything', async () => {
    await cron.handleWeeklySummary();

    expect(prisma.vendor.findMany).not.toHaveBeenCalled();
    expect(rabbitmq.publish).not.toHaveBeenCalled();
    expect((cron as any).logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        weekStart: weekStartStr,
        weekEnd: '2026-11-27',
      }),
      'Vendor weekly summary completed with no activity',
    );
  });

  it('only summarises active, approved vendors', async () => {
    prisma.$queryRaw.mockResolvedValue([row()]);

    await cron.handleWeeklySummary();

    expect(prisma.vendor.findMany.mock.calls[0][0].where).toEqual({
      id: { in: ['vendor-1'] },
      isActive: true,
      isApproved: true,
    });
  });

  it('builds one summary per vendor from the ranked product rows and emails it with their balances', async () => {
    prisma.$queryRaw.mockResolvedValue([
      row({ productName: 'Red Shoe', totalSold: '6', productRevenue: '30000' }),
      row({ productName: 'Blue Hat', totalSold: '2', productRevenue: '20000' }),
    ]);
    prisma.vendor.findMany.mockResolvedValue([approvedVendor()]);

    await cron.handleWeeklySummary();

    expect(templates.weeklyVendorSummary).toHaveBeenCalledWith({
      vendorStoreName: 'Shop',
      ordersCount: 4,
      revenue: 50000,
      pendingBalance: 1200,
      settledBalance: 8800,
      bestSellingProducts: [
        { name: 'Red Shoe', quantity: 6, revenue: 30000 },
        { name: 'Blue Hat', quantity: 2, revenue: 20000 },
      ],
      weekStart: weekStartStr,
      weekEnd: '2026-11-27',
      currency: 'NGN',
    });
    expect(rabbitmq.publish).toHaveBeenCalledWith(RABBITMQ_QUEUES.EMAILS, {
      to: 'v@shop.com',
      subject: 'Your Weekly Earnings Summary - NUTS',
      html: '<html>summary</html>',
      type: 'vendor_weekly_summary',
      metadata: { vendorId: 'vendor-1', weekStart: weekStartStr },
    });
    expect(rabbitmq.publish).toHaveBeenCalledWith(
      RABBITMQ_QUEUES.NOTIFICATIONS,
      expect.objectContaining({
        userId: 'vendor-1',
        role: ROLE.VENDOR,
        type: NotificationType.SYSTEM_ANNOUNCEMENT,
        link: '/vendor/analytics',
      }),
    );
    expect(redis.set).toHaveBeenCalledWith(
      `weekly-summary:${generateJobId('weekly-summary', 'vendor-1', weekStartStr)}`,
      'sent',
      'EX',
      7 * 24 * 3600,
    );
  });

  it('treats a missing wallet as zero balances', async () => {
    prisma.$queryRaw.mockResolvedValue([row()]);
    prisma.vendor.findMany.mockResolvedValue([
      approvedVendor({ vendorWallet: null }),
    ]);

    await cron.handleWeeklySummary();

    expect(templates.weeklyVendorSummary).toHaveBeenCalledWith(
      expect.objectContaining({ pendingBalance: 0, settledBalance: 0 }),
    );
  });

  it('does not send the same week twice to a vendor', async () => {
    prisma.$queryRaw.mockResolvedValue([row()]);
    prisma.vendor.findMany.mockResolvedValue([approvedVendor()]);
    redis.get.mockResolvedValue('sent');

    await cron.handleWeeklySummary();

    expect(rabbitmq.publish).not.toHaveBeenCalled();
  });

  it('skips a vendor that is no longer active or approved, and keeps the rest', async () => {
    prisma.$queryRaw.mockResolvedValue([
      row({ vendorId: 'vendor-1' }),
      row({ vendorId: 'vendor-2' }),
    ]);
    prisma.vendor.findMany.mockResolvedValue([
      approvedVendor({ id: 'vendor-2', email: 'two@shop.com' }),
    ]);

    await cron.handleWeeklySummary();

    const emails = rabbitmq.publish.mock.calls.filter(
      (c) => c[0] === RABBITMQ_QUEUES.EMAILS,
    );
    expect(emails.map((c) => c[1].to)).toEqual(['two@shop.com']);
  });

  it('logs a failure and rethrows it so the scheduler records the run as failed', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('db down'));

    await expect(cron.handleWeeklySummary()).rejects.toThrow('db down');
    expect((cron as any).logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'db down' }),
      'Vendor weekly summary cron failed',
    );
  });
});
