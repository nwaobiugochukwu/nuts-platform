import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  WalletTransactionReason,
  WalletTransactionType,
} from '@prisma/client';
import { randomBytes } from 'crypto';

import { PrismaService } from '@api/infrastructure/prisma/prisma.service';

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  private static readonly REFERRED_USER_REWARD_PERCENT = new Prisma.Decimal(
    '0.10',
  );

  private static readonly REFERRED_USER_REWARD_CAP = new Prisma.Decimal('5000');

  private static readonly REFERRER_REWARD_PERCENT = new Prisma.Decimal('0.05');

  private static readonly REFERRER_REWARD_CAP = new Prisma.Decimal('10000');

  private static readonly MAX_CODE_GENERATION_ATTEMPTS = 10;

  private static readonly REWARD_TRANSACTION_MAX_WAIT_MS = 5000;

  private static readonly REWARD_TRANSACTION_TIMEOUT_MS = 10000;

  private static readonly MAX_SERIALIZABLE_RETRIES = 3;

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // REFERRAL CODE
  // ---------------------------------------------------------------------------

  private generateCode(): string {
    return randomBytes(4).toString('hex').toUpperCase();
  }

  async createReferralCode(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    for (
      let attempt = 0;
      attempt < ReferralService.MAX_CODE_GENERATION_ATTEMPTS;
      attempt++
    ) {
      const code = this.generateCode();

      try {
        await tx.referralCode.create({
          data: {
            userId,
            code,
          },
        });

        return;
      } catch (error) {
        /*
         * The database UNIQUE constraint is the real source of truth.
         *
         * If two registrations happen to generate the same random code,
         * PostgreSQL rejects one and we simply generate another.
         */
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          continue;
        }

        throw error;
      }
    }

    throw new Error(
      'Unable to generate a unique referral code after multiple attempts',
    );
  }

  // ---------------------------------------------------------------------------
  // VALIDATION
  // ---------------------------------------------------------------------------

  async validateReferralCode(
    code: string,
    registrantEmail: string,
  ): Promise<{
    id: string;
    userId: string;
  }> {
    const normalizedCode = code.trim().toUpperCase();

    const normalizedEmail = registrantEmail.trim().toLowerCase();

    const referralCode = await this.prisma.referralCode.findUnique({
      where: {
        code: normalizedCode,
      },
      select: {
        id: true,
        userId: true,
        user: {
          select: {
            email: true,
          },
        },
      },
    });

    if (!referralCode) {
      throw new BadRequestException('Invalid referral code');
    }

    if (referralCode.user.email.toLowerCase() === normalizedEmail) {
      throw new BadRequestException('You cannot use your own referral code');
    }

    return {
      id: referralCode.id,
      userId: referralCode.userId,
    };
  }

  // ---------------------------------------------------------------------------
  // APPLY REFERRAL
  // ---------------------------------------------------------------------------

  async applyReferralAtSignup(
    newUserId: string,
    referralCode: string,
  ): Promise<void> {
    const normalizedCode = referralCode.trim().toUpperCase();

    const codeRecord = await this.prisma.referralCode.findUnique({
      where: {
        code: normalizedCode,
      },
      select: {
        id: true,
        userId: true,
      },
    });

    if (!codeRecord) {
      throw new BadRequestException('Referral code is invalid');
    }

    await this.createReferralRelationship(
      this.prisma,
      newUserId,
      codeRecord.id,
      codeRecord.userId,
    );
  }

  /*
   * IMPORTANT:
   *
   * This method receives Prisma.TransactionClient.
   *
   * That means every query performed by createReferralRelationship()
   * participates in the caller's transaction.
   */
  async applyReferralAtSignupById(
    tx: Prisma.TransactionClient,
    newUserId: string,
    referralCodeId: string,
    referrerUserId: string,
  ): Promise<void> {
    await this.createReferralRelationship(
      tx,
      newUserId,
      referralCodeId,
      referrerUserId,
    );
  }

  private async createReferralRelationship(
    db: Prisma.TransactionClient | PrismaService,
    newUserId: string,
    referralCodeId: string,
    referrerUserId: string,
  ): Promise<void> {
    if (referrerUserId === newUserId) {
      throw new BadRequestException('Cannot refer yourself');
    }

    try {
      await db.referral.create({
        data: {
          referralCodeId,
          referrerId: referrerUserId,
          referredUserId: newUserId,
          rewardGranted: false,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(
          'This user already has a referral relationship',
        );
      }

      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // REFERRAL REWARDS
  // ---------------------------------------------------------------------------

  async grantReferralRewards(orderId: string, userId: string): Promise<void> {
    /*
     * Serializable protects this critical section against concurrent
     * reward-processing transactions.
     *
     * Example:
     *
     * Request A -> sees rewardGranted = false
     * Request B -> sees rewardGranted = false
     *
     * Without appropriate concurrency protection, both could potentially
     * continue toward paying the reward.
     *
     * With Serializable, PostgreSQL detects the conflicting transaction
     * and Prisma can return P2034. We retry a small number of times.
     */
    for (
      let attempt = 0;
      attempt < ReferralService.MAX_SERIALIZABLE_RETRIES;
      attempt++
    ) {
      try {
        await this.prisma.$transaction(
          async (tx) => {
            const referral = await tx.referral.findUnique({
              where: {
                referredUserId: userId,
              },
              select: {
                id: true,
                referrerId: true,
                rewardGranted: true,
              },
            });

            if (!referral || referral.rewardGranted) {
              return;
            }

            const order = await tx.order.findFirst({
              where: {
                id: orderId,
                userId,
                status: 'DELIVERED',
              },
              select: {
                totalAmount: true,
              },
            });

            if (!order) {
              throw new NotFoundException(
                'Delivered order not found for this user',
              );
            }

            /*
             * Prisma Decimal is used throughout the calculation.
             * Never convert monetary values to JavaScript Number.
             */
            const referredUserReward = Prisma.Decimal.min(
              order.totalAmount
                .mul(ReferralService.REFERRED_USER_REWARD_PERCENT)
                .toDecimalPlaces(2),
              ReferralService.REFERRED_USER_REWARD_CAP,
            );

            const referrerReward = Prisma.Decimal.min(
              order.totalAmount
                .mul(ReferralService.REFERRER_REWARD_PERCENT)
                .toDecimalPlaces(2),
              ReferralService.REFERRER_REWARD_CAP,
            );

            /*
             * Both wallets must exist.
             *
             * A missing wallet indicates broken application data and
             * should cause the entire transaction to fail.
             */
            const wallets = await tx.userWallet.findMany({
              where: {
                userId: {
                  in: [userId, referral.referrerId],
                },
              },
              select: {
                id: true,
                userId: true,
              },
            });

            if (wallets.length !== 2) {
              throw new NotFoundException(
                'Referral wallet(s) could not be found',
              );
            }

            const walletByUserId = new Map(
              wallets.map((wallet) => [wallet.userId, wallet]),
            );

            const referredWallet = walletByUserId.get(userId);

            const referrerWallet = walletByUserId.get(referral.referrerId);

            if (!referredWallet || !referrerWallet) {
              throw new NotFoundException(
                'Referral wallet(s) could not be found',
              );
            }

            /*
             * Conditional update is still important even with Serializable.
             *
             * It makes the business invariant explicit:
             *
             * false -> true
             *
             * Only the request that successfully claims the referral
             * is allowed to continue to the wallet credits.
             */
            const claimed = await tx.referral.updateMany({
              where: {
                id: referral.id,
                rewardGranted: false,
              },
              data: {
                rewardGranted: true,
              },
            });

            if (claimed.count !== 1) {
              return;
            }

            /*
             * Both credits and their ledger entries are part of the
             * SAME transaction as rewardGranted.
             *
             * If either credit fails:
             *
             * rewardGranted -> rolled back
             * wallet #1      -> rolled back
             * wallet #2      -> rolled back
             * transaction #1 -> rolled back
             * transaction #2 -> rolled back
             */
            await this.creditWallet(
              tx,
              referredWallet.id,
              referredUserReward,
              WalletTransactionReason.REFERRAL,
              orderId,
            );

            await this.creditWallet(
              tx,
              referrerWallet.id,
              referrerReward,
              WalletTransactionReason.REFERRAL,
              orderId,
            );
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,

            maxWait: ReferralService.REWARD_TRANSACTION_MAX_WAIT_MS,

            timeout: ReferralService.REWARD_TRANSACTION_TIMEOUT_MS,
          },
        );

        // Transaction completed successfully.
        return;
      } catch (error) {
        /*
         * Prisma P2034 means a transaction conflict occurred at
         * Serializable isolation.
         *
         * Retrying is appropriate for this specific transient error.
         */
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          attempt < ReferralService.MAX_SERIALIZABLE_RETRIES - 1
        ) {
          this.logger.warn(
            `Referral reward transaction conflict. Retrying attempt ${
              attempt + 2
            }/${ReferralService.MAX_SERIALIZABLE_RETRIES}.`,
          );

          continue;
        }

        throw error;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // REFERRAL LOOKUPS
  // ---------------------------------------------------------------------------

  async getUnrewardedReferral(userId: string): Promise<{
    id: string;
    referrerId: string;
  } | null> {
    const referral = await this.prisma.referral.findUnique({
      where: {
        referredUserId: userId,
      },
      select: {
        id: true,
        referrerId: true,
        rewardGranted: true,
      },
    });

    if (!referral || referral.rewardGranted) {
      return null;
    }

    return {
      id: referral.id,
      referrerId: referral.referrerId,
    };
  }

  async hasPendingReferral(userId: string): Promise<boolean> {
    const referral = await this.prisma.referral.findUnique({
      where: {
        referredUserId: userId,
      },
      select: {
        rewardGranted: true,
      },
    });

    return referral?.rewardGranted === false;
  }

  // ---------------------------------------------------------------------------
  // WALLET
  // ---------------------------------------------------------------------------

  private async creditWallet(
    tx: Prisma.TransactionClient,
    walletId: string,
    amount: Prisma.Decimal,
    reason: WalletTransactionReason,
    referenceId: string,
  ): Promise<void> {
    if (amount.lte(0)) {
      return;
    }

    /*
     * Balance update and ledger entry are intentionally in the same
     * database transaction.
     */
    await tx.userWallet.update({
      where: {
        id: walletId,
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
        userWalletId: walletId,
      },
    });
  }
}
