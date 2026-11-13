import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  WalletTransactionReason,
  WalletTransactionType,
} from '@prisma/client';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { WalletService } from './wallet.service';

describe('WalletService', () => {
  let service: WalletService;
  let mockPrisma: any;

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

    service = new WalletService(mockPrisma);
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
});
