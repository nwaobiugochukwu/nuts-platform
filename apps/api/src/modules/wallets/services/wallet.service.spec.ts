import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  WalletTransactionReason,
  WalletTransactionType,
} from '@prisma/client';
import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { FakeTransactionRunner } from '@api/infrastructure/database/fake-transaction-runner-spec';
import { WalletService } from './wallet.service';

describe('WalletService', () => {
  let service: WalletService;
  let mockPrisma: any;
  let runner: FakeTransactionRunner;

  beforeEach(() => {
    mockPrisma = {
      userWallet: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      vendorWallet: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      walletTransaction: {
        create: jest.fn(),
      },
      vendorTransaction: {
        create: jest.fn(),
      },
      $transaction: jest.fn((callback: (tx: any) => Promise<unknown>) =>
        callback(mockPrisma),
      ),
    };

    runner = new FakeTransactionRunner(mockPrisma);
    service = new WalletService(mockPrisma, runner as never);
  });

  describe('getUserWallet', () => {
    it('returns wallet if found', async () => {
      const mockWallet = {
        id: 'w-1',
        userId: 'u-1',
        balance: new Prisma.Decimal(5000),
      };
      mockPrisma.userWallet.findUnique.mockResolvedValue(mockWallet);

      const wallet = await service.getUserWallet('u-1');
      expect(wallet).toEqual(mockWallet);
    });

    it('throws NotFoundException if user wallet does not exist', async () => {
      mockPrisma.userWallet.findUnique.mockResolvedValue(null);

      await expect(service.getUserWallet('u-missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('creditUserWallet', () => {
    it('rejects zero or negative amounts', async () => {
      await expect(
        service.creditUserWallet(
          'u-1',
          new Prisma.Decimal(0),
          WalletTransactionReason.REFERRAL,
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.creditUserWallet(
          'u-1',
          new Prisma.Decimal(-100),
          WalletTransactionReason.REFERRAL,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('atomically increments wallet balance and writes transaction audit row', async () => {
      mockPrisma.userWallet.findUnique.mockResolvedValue({ id: 'w-1' });
      mockPrisma.userWallet.update.mockResolvedValue({
        id: 'w-1',
        balance: new Prisma.Decimal(1500),
      });
      mockPrisma.walletTransaction.create.mockResolvedValue({ id: 'wt-1' });

      await service.creditUserWallet(
        'u-1',
        new Prisma.Decimal(500),
        WalletTransactionReason.REFERRAL,
        'ref-123',
      );

      expect(mockPrisma.userWallet.update).toHaveBeenCalledWith({
        where: { userId: 'u-1' },
        data: { balance: { increment: new Prisma.Decimal(500) } },
      });

      expect(mockPrisma.walletTransaction.create).toHaveBeenCalledWith({
        data: {
          amount: new Prisma.Decimal(500),
          type: WalletTransactionType.CREDIT,
          reason: WalletTransactionReason.REFERRAL,
          referenceId: 'ref-123',
          userWalletId: 'w-1',
        },
      });
    });
  });

  describe('debitUserWallet', () => {
    it('prevents overdraft via atomic conditional updateMany (balance >= amount)', async () => {
      mockPrisma.userWallet.findUnique.mockResolvedValue({ id: 'w-1' });
      // updateMany returns count: 0 when balance is insufficient (race protection)
      mockPrisma.userWallet.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.debitUserWallet(
          'u-1',
          new Prisma.Decimal(1000),
          WalletTransactionReason.SALE,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.userWallet.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'u-1',
          balance: { gte: new Prisma.Decimal(1000) },
        },
        data: {
          balance: { decrement: new Prisma.Decimal(1000) },
        },
      });

      expect(mockPrisma.walletTransaction.create).not.toHaveBeenCalled();
    });

    it('successfully debits when sufficient balance exists', async () => {
      mockPrisma.userWallet.findUnique.mockResolvedValue({ id: 'w-1' });
      mockPrisma.userWallet.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.walletTransaction.create.mockResolvedValue({ id: 'wt-2' });

      await service.debitUserWallet(
        'u-1',
        new Prisma.Decimal(300),
        WalletTransactionReason.SALE,
        'order-999',
      );

      expect(mockPrisma.walletTransaction.create).toHaveBeenCalledWith({
        data: {
          amount: new Prisma.Decimal(300),
          type: WalletTransactionType.DEBIT,
          reason: WalletTransactionReason.SALE,
          referenceId: 'order-999',
          userWalletId: 'w-1',
        },
      });
    });
  });

  describe('settleVendorEarning', () => {
    it('moves pending earnings into available balance upon order delivery', async () => {
      mockPrisma.vendorWallet.findUnique.mockResolvedValue({ id: 'vw-1' });
      mockPrisma.vendorWallet.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.vendorTransaction.create.mockResolvedValue({ id: 'vt-1' });

      await service.settleVendorEarning(
        'vendor-1',
        new Prisma.Decimal(2500),
        'order-10',
        mockPrisma,
      );

      expect(mockPrisma.vendorWallet.updateMany).toHaveBeenCalledWith({
        where: {
          vendorId: 'vendor-1',
          pendingBalance: { gte: new Prisma.Decimal(2500) },
        },
        data: {
          pendingBalance: { decrement: new Prisma.Decimal(2500) },
          balance: { increment: new Prisma.Decimal(2500) },
        },
      });
    });
  });

  describe('vendor wallet changes', () => {
    const amount = new Prisma.Decimal(2500);
    beforeEach(() => {
      mockPrisma.vendorWallet.findUnique.mockResolvedValue({ id: 'vw-1' });
      mockPrisma.walletTransaction.create.mockResolvedValue({});
    });

    it('credits pending earnings and lifetime earnings, with a SALE ledger row', async () => {
      await service.creditVendorPending('vendor-1', amount, 'order-1');

      expect(mockPrisma.vendorWallet.update).toHaveBeenCalledWith({
        where: { vendorId: 'vendor-1' },
        data: {
          pendingBalance: { increment: amount },
          lifetimeEarnings: { increment: amount },
        },
      });
      expect(mockPrisma.walletTransaction.create).toHaveBeenCalledWith({
        data: {
          amount,
          type: WalletTransactionType.CREDIT,
          reason: WalletTransactionReason.SALE,
          referenceId: 'order-1',
          vendorWalletId: 'vw-1',
        },
      });
      expect(runner.runs).toEqual(['wallet.credit-vendor-pending']);
    });

    it('reverses pending earnings for a refund and records a REFUND debit', async () => {
      mockPrisma.vendorWallet.updateMany.mockResolvedValue({ count: 1 });

      await service.debitVendorPending('vendor-1', amount, 'order-1');

      expect(mockPrisma.vendorWallet.updateMany).toHaveBeenCalledWith({
        where: { vendorId: 'vendor-1', pendingBalance: { gte: amount } },
        data: {
          pendingBalance: { decrement: amount },
          lifetimeEarnings: { decrement: amount },
        },
      });
      expect(mockPrisma.walletTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: WalletTransactionType.DEBIT,
          reason: WalletTransactionReason.REFUND,
        }),
      });
    });

    it('never writes a ledger row for a reversal the balance could not cover', async () => {
      mockPrisma.vendorWallet.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.debitVendorPending('vendor-1', amount, 'order-1'),
      ).rejects.toThrow('Insufficient pending balance for reversal');
      expect(mockPrisma.walletTransaction.create).not.toHaveBeenCalled();
    });

    it('refuses to settle more than is pending', async () => {
      mockPrisma.vendorWallet.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.settleVendorEarning('vendor-1', amount, 'order-1'),
      ).rejects.toThrow('Insufficient pending balance');
      expect(mockPrisma.walletTransaction.create).not.toHaveBeenCalled();
    });

    it('says so when the vendor has no wallet, writing nothing', async () => {
      mockPrisma.vendorWallet.findUnique.mockResolvedValue(null);

      await expect(
        service.creditVendorPending('vendor-1', amount, 'order-1'),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.vendorWallet.update).not.toHaveBeenCalled();
    });

    it.each([
      [
        'credit',
        (tx?: unknown) =>
          service.creditVendorPending('v', amount, 'o', tx as never),
      ],
      [
        'debit',
        (tx?: unknown) =>
          service.debitVendorPending('v', amount, 'o', tx as never),
      ],
      [
        'settle',
        (tx?: unknown) =>
          service.settleVendorEarning('v', amount, 'o', tx as never),
      ],
    ])(
      'a %s inside the caller’s transaction uses that transaction’s client',
      async (_n, call) => {
        mockPrisma.vendorWallet.updateMany.mockResolvedValue({ count: 1 });
        const callerTx = {
          ...mockPrisma,
          vendorWallet: {
            findUnique: jest.fn().mockResolvedValue({ id: 'vw-9' }),
            update: jest.fn(),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          walletTransaction: { create: jest.fn() },
        };

        await call(callerTx);

        expect(callerTx.walletTransaction.create).toHaveBeenCalledTimes(1);
        expect(mockPrisma.walletTransaction.create).not.toHaveBeenCalled();
      },
    );

    it('rejects a zero or negative amount before touching anything', async () => {
      await expect(
        service.creditVendorPending('vendor-1', new Prisma.Decimal(0), 'o'),
      ).rejects.toThrow(BadRequestException);
      expect(runner.runs).toHaveLength(0);
    });
  });
});
