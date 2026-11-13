import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  Prisma,
  WalletTransactionReason,
  WalletTransactionType,
} from '@prisma/client';

import { PrismaService } from '@api/infrastructure/prisma/prisma.service';

import { buildPaginationMeta } from '@api/common/utils/pagination-meta.util';
import { VENDOR_COMMISSION_RATE } from '@api/common/constants/commission.constants';

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * User wallets are expected to be created during user registration.
   *
   * Reads should therefore NOT create data as a side effect.
   */
  async getUserWallet(userId: string) {
    const wallet = await this.prisma.userWallet.findUnique({
      where: {
        userId,
      },
    });

    if (!wallet) {
      throw new NotFoundException('User wallet not found');
    }

    return wallet;
  }

  /**
   * Vendor wallets should also be created during vendor onboarding.
   *
   * This method is intentionally read-only.
   */
  async getVendorWallet(vendorId: string) {
    const wallet = await this.prisma.vendorWallet.findUnique({
      where: {
        vendorId,
      },
    });

    if (!wallet) {
      throw new NotFoundException('Vendor wallet not found');
    }

    return wallet;
  }

  async creditUserWallet(
    userId: string,
    amount: Prisma.Decimal,
    reason: WalletTransactionReason,
    referenceId?: string,
  ): Promise<void> {
    this.assertPositiveAmount(amount);

    await this.prisma.$transaction(async (tx) => {
      const wallet = await tx.userWallet.findUnique({
        where: {
          userId,
        },
        select: {
          id: true,
        },
      });

      if (!wallet) {
        throw new NotFoundException('User wallet not found');
      }

      /**
       * Atomic increment prevents a lost-update race.
       */
      await tx.userWallet.update({
        where: {
          userId,
        },
        data: {
          balance: {
            increment: amount,
          },
        },
      });

      await tx.walletTransaction.create({
        data: {
          amount,
          type: WalletTransactionType.CREDIT,
          reason,
          referenceId,
          userWalletId: wallet.id,
        },
      });
    });
  }

  async debitUserWallet(
    userId: string,
    amount: Prisma.Decimal,
    reason: WalletTransactionReason,
    referenceId?: string,
  ): Promise<void> {
    this.assertPositiveAmount(amount);

    await this.prisma.$transaction(async (tx) => {
      const wallet = await tx.userWallet.findUnique({
        where: {
          userId,
        },
        select: {
          id: true,
        },
      });

      if (!wallet) {
        throw new NotFoundException('User wallet not found');
      }

      /**
       * IMPORTANT:
       *
       * Do not:
       *
       * 1. read balance
       * 2. check balance
       * 3. decrement
       *
       * Two requests could both read the same balance.
       *
       * Instead, the database performs:
       *
       * balance >= amount
       * AND
       * balance = balance - amount
       *
       * as one update.
       */
      const result = await tx.userWallet.updateMany({
        where: {
          userId,
          balance: {
            gte: amount,
          },
        },
        data: {
          balance: {
            decrement: amount,
          },
        },
      });

      if (result.count !== 1) {
        throw new BadRequestException('Insufficient wallet balance');
      }

      await tx.walletTransaction.create({
        data: {
          amount,
          type: WalletTransactionType.DEBIT,
          reason,
          referenceId,
          userWalletId: wallet.id,
        },
      });
    });
  }

  async creditVendorPending(
    vendorId: string,
    amount: Prisma.Decimal,
    referenceId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    this.assertPositiveAmount(amount);

    const execute = async (client: Prisma.TransactionClient): Promise<void> => {
      const wallet = await this.getVendorWalletInTransaction(client, vendorId);

      await client.vendorWallet.update({
        where: {
          vendorId,
        },
        data: {
          pendingBalance: {
            increment: amount,
          },
          lifetimeEarnings: {
            increment: amount,
          },
        },
      });

      await client.walletTransaction.create({
        data: {
          amount,
          type: WalletTransactionType.CREDIT,
          reason: WalletTransactionReason.SALE,
          referenceId,
          vendorWalletId: wallet.id,
        },
      });
    };

    if (tx) {
      await execute(tx);
      return;
    }

    await this.prisma.$transaction(execute);
  }

  async settleVendorEarning(
    vendorId: string,
    amount: Prisma.Decimal,
    referenceId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    this.assertPositiveAmount(amount);

    const execute = async (client: Prisma.TransactionClient): Promise<void> => {
      const wallet = await this.getVendorWalletInTransaction(client, vendorId);

      /**
       * Transfer:
       *
       * pendingBalance -> balance
       *
       * The condition prevents pendingBalance from becoming negative.
       */
      const result = await client.vendorWallet.updateMany({
        where: {
          vendorId,
          pendingBalance: {
            gte: amount,
          },
        },
        data: {
          pendingBalance: {
            decrement: amount,
          },
          balance: {
            increment: amount,
          },
        },
      });

      if (result.count !== 1) {
        throw new BadRequestException('Insufficient pending balance');
      }

      await client.walletTransaction.create({
        data: {
          amount,
          type: WalletTransactionType.CREDIT,
          reason: WalletTransactionReason.COMMISSION,
          referenceId,
          vendorWalletId: wallet.id,
        },
      });
    };

    if (tx) {
      await execute(tx);
      return;
    }

    await this.prisma.$transaction(execute);
  }

  async debitVendorPending(
    vendorId: string,
    amount: Prisma.Decimal,
    referenceId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    this.assertPositiveAmount(amount);

    const execute = async (client: Prisma.TransactionClient): Promise<void> => {
      const wallet = await this.getVendorWalletInTransaction(client, vendorId);

      /**
       * This is the critical fix.
       *
       * Your old implementation ignored `count`.
       *
       * That allowed:
       *
       * pendingBalance = 5,000
       * refund = 10,000
       *
       * to create a -10,000 ledger entry even though the balance
       * was never actually decremented.
       */
      const result = await client.vendorWallet.updateMany({
        where: {
          vendorId,
          pendingBalance: {
            gte: amount,
          },
        },
        data: {
          pendingBalance: {
            decrement: amount,
          },
          lifetimeEarnings: {
            decrement: amount,
          },
        },
      });

      if (result.count !== 1) {
        throw new BadRequestException(
          'Insufficient pending balance for reversal',
        );
      }

      await client.walletTransaction.create({
        data: {
          amount,
          type: WalletTransactionType.DEBIT,
          reason: WalletTransactionReason.REFUND,
          referenceId,
          vendorWalletId: wallet.id,
        },
      });
    };

    if (tx) {
      await execute(tx);
      return;
    }

    await this.prisma.$transaction(execute);
  }

  async getUserWalletWithTransactions(userId: string, limit = 20) {
    const wallet = await this.prisma.userWallet.findUnique({
      where: {
        userId,
      },
      select: {
        id: true,
        balance: true,
        createdAt: true,
        updatedAt: true,

        transactions: {
          orderBy: {
            createdAt: 'desc',
          },
          take: limit,
          select: {
            id: true,
            amount: true,
            type: true,
            reason: true,
            referenceId: true,
            createdAt: true,
          },
        },
      },
    });

    if (!wallet) {
      throw new NotFoundException('User wallet not found');
    }

    return {
      id: wallet.id,
      balance: Number(wallet.balance),
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,

      transactions: wallet.transactions.map((transaction) =>
        this.toTransactionResponse(transaction),
      ),
    };
  }

  async getVendorWalletWithTransactions(vendorId: string, limit = 20) {
    let wallet = await this.prisma.vendorWallet.findUnique({
      where: {
        vendorId,
      },
      select: {
        id: true,
        balance: true,
        pendingBalance: true,
        lifetimeEarnings: true,
        createdAt: true,
        updatedAt: true,

        transactions: {
          orderBy: {
            createdAt: 'desc',
          },
          take: limit,
          select: {
            id: true,
            amount: true,
            type: true,
            reason: true,
            referenceId: true,
            createdAt: true,
          },
        },
      },
    });

    if (!wallet) {
      await this.prisma.vendorWallet.create({
        data: { vendorId },
      });
      wallet = await this.prisma.vendorWallet.findUnique({
        where: { vendorId },
        select: {
          id: true,
          balance: true,
          pendingBalance: true,
          lifetimeEarnings: true,
          createdAt: true,
          updatedAt: true,
          transactions: {
            take: limit,
            select: {
              id: true,
              amount: true,
              type: true,
              reason: true,
              referenceId: true,
              createdAt: true,
            },
          },
        },
      });
    }

    if (!wallet) {
      throw new NotFoundException('Vendor wallet not found');
    }

    let balanceNum = Number(wallet.balance);
    let pendingNum = Number(wallet.pendingBalance);
    let lifetimeNum = Number(wallet.lifetimeEarnings);

    if (balanceNum === 0 && pendingNum === 0 && lifetimeNum === 0) {
      const orderSales = await this.prisma.orderItem.findMany({
        where: { vendorId },
        include: { order: true },
      });

      if (orderSales.length > 0) {
        for (const item of orderSales) {
          const itemTotal =
            Math.round(Number(item.totalPrice) * VENDOR_COMMISSION_RATE * 100) /
            100;
          if (item.order?.status === 'DELIVERED') {
            balanceNum += itemTotal;
          } else if (
            item.order?.status !== 'CANCELLED' &&
            item.order?.status !== 'REFUNDED'
          ) {
            pendingNum += itemTotal;
          }
        }
        lifetimeNum = balanceNum + pendingNum;

        if (lifetimeNum > 0) {
          await this.prisma.vendorWallet.update({
            where: { vendorId },
            data: {
              balance: balanceNum,
              pendingBalance: pendingNum,
              lifetimeEarnings: lifetimeNum,
            },
          });
        }
      }
    }

    return {
      id: wallet.id,
      balance: balanceNum,
      pendingBalance: pendingNum,
      lifetimeEarnings: lifetimeNum,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,

      transactions: wallet.transactions.map((transaction) =>
        this.toTransactionResponse(transaction),
      ),
    };
  }

  async getUserWalletTransactionsPaginated(
    userId: string,
    page: number,
    limit: number,
  ) {
    const wallet = await this.prisma.userWallet.findUnique({
      where: {
        userId,
      },
      select: {
        id: true,
      },
    });

    if (!wallet) {
      throw new NotFoundException('User wallet not found');
    }

    const skip = (page - 1) * limit;

    /**
     * Both queries use the same indexed:
     *
     * @@index([userWalletId, createdAt])
     *
     * so this pagination query is appropriate for the current model.
     */
    const [transactions, total] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where: {
          userWalletId: wallet.id,
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
        select: {
          id: true,
          amount: true,
          type: true,
          reason: true,
          referenceId: true,
          createdAt: true,
        },
      }),

      this.prisma.walletTransaction.count({
        where: {
          userWalletId: wallet.id,
        },
      }),
    ]);

    return {
      data: transactions.map((transaction) =>
        this.toTransactionResponse(transaction),
      ),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async getVendorWalletTransactionsPaginated(
    vendorId: string,
    page: number,
    limit: number,
  ) {
    const wallet = await this.prisma.vendorWallet.findUnique({
      where: {
        vendorId,
      },
      select: {
        id: true,
      },
    });

    if (!wallet) {
      throw new NotFoundException('Vendor wallet not found');
    }

    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where: {
          vendorWalletId: wallet.id,
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
        select: {
          id: true,
          amount: true,
          type: true,
          reason: true,
          referenceId: true,
          createdAt: true,
        },
      }),

      this.prisma.walletTransaction.count({
        where: {
          vendorWalletId: wallet.id,
        },
      }),
    ]);

    return {
      data: transactions.map((transaction) =>
        this.toTransactionResponse(transaction),
      ),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  private async getVendorWalletInTransaction(
    client: Prisma.TransactionClient,
    vendorId: string,
  ) {
    const wallet = await client.vendorWallet.findUnique({
      where: {
        vendorId,
      },
      select: {
        id: true,
      },
    });

    if (!wallet) {
      throw new NotFoundException('Vendor wallet not found');
    }

    return wallet;
  }

  private toTransactionResponse(transaction: {
    id: string;
    amount: Prisma.Decimal;
    type: WalletTransactionType;
    reason: WalletTransactionReason;
    referenceId: string | null;
    createdAt: Date;
  }) {
    return {
      id: transaction.id,
      amount: Number(transaction.amount),
      type: transaction.type,
      reason: transaction.reason,
      referenceId: transaction.referenceId,
      createdAt: transaction.createdAt,
    };
  }

  private assertPositiveAmount(amount: Prisma.Decimal): void {
    if (amount.lte(0)) {
      throw new BadRequestException('Wallet amount must be greater than zero');
    }
  }
}
