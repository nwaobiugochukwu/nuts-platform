import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  WalletTransactionReason,
  WalletTransactionType,
} from '@prisma/client';
import { ReferralService } from './referral.service';

const known = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test',
  });

describe('ReferralService', () => {
  let service: ReferralService;
  let prisma: any;
  let tx: any;
  let outbox: { appendEnvelope: jest.Mock; wakeRelay: jest.Mock };

  beforeEach(() => {
    tx = {
      referral: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      referralCode: { create: jest.fn() },
      order: { findFirst: jest.fn() },
      user: { findUnique: jest.fn() },
      userWallet: { findMany: jest.fn(), update: jest.fn() },
      walletTransaction: { create: jest.fn() },
    };
    prisma = {
      ...tx,
      referral: { create: jest.fn(), findUnique: jest.fn() },
      referralCode: { create: jest.fn(), findUnique: jest.fn() },
      $transaction: jest.fn((cb: (t: any) => Promise<unknown>) => cb(tx)),
    };
    outbox = {
      appendEnvelope: jest.fn().mockResolvedValue('e-1'),
      wakeRelay: jest.fn(),
    };
    service = new ReferralService(prisma, outbox as never);
    jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
  });

  describe('createReferralCode', () => {
    it('stores the first generated code', async () => {
      tx.referralCode.create.mockResolvedValue({});

      await service.createReferralCode(tx, 'user-1');

      expect(tx.referralCode.create).toHaveBeenCalledTimes(1);
      const data = tx.referralCode.create.mock.calls[0][0].data;
      expect(data.userId).toBe('user-1');
      expect(data.code).toMatch(/^[0-9A-F]{8}$/);
    });

    it('generates another code when the database reports a duplicate', async () => {
      tx.referralCode.create
        .mockRejectedValueOnce(known('P2002'))
        .mockRejectedValueOnce(known('P2002'))
        .mockResolvedValueOnce({});

      await service.createReferralCode(tx, 'user-1');

      expect(tx.referralCode.create).toHaveBeenCalledTimes(3);
    });

    it('rethrows an error that is not a duplicate', async () => {
      tx.referralCode.create.mockRejectedValue(new Error('connection lost'));

      await expect(service.createReferralCode(tx, 'user-1')).rejects.toThrow(
        'connection lost',
      );
      expect(tx.referralCode.create).toHaveBeenCalledTimes(1);
    });

    it('gives up after 10 duplicate codes', async () => {
      tx.referralCode.create.mockRejectedValue(known('P2002'));

      await expect(service.createReferralCode(tx, 'user-1')).rejects.toThrow(
        'Unable to generate a unique referral code after multiple attempts',
      );
      expect(tx.referralCode.create).toHaveBeenCalledTimes(10);
    });
  });

  describe('validateReferralCode', () => {
    it('trims and upper-cases the code and returns the ids', async () => {
      prisma.referralCode.findUnique.mockResolvedValue({
        id: 'code-1',
        userId: 'referrer-1',
        user: { email: 'referrer@example.com' },
      });

      const result = await service.validateReferralCode(
        '  ab12cd34 ',
        'New@Example.com',
      );

      expect(prisma.referralCode.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { code: 'AB12CD34' } }),
      );
      expect(result).toEqual({ id: 'code-1', userId: 'referrer-1' });
    });

    it('rejects an unknown code', async () => {
      prisma.referralCode.findUnique.mockResolvedValue(null);

      await expect(
        service.validateReferralCode('NOPE', 'a@b.com'),
      ).rejects.toThrow(new BadRequestException('Invalid referral code'));
    });

    it('rejects the owner using their own code, ignoring email case and spaces', async () => {
      prisma.referralCode.findUnique.mockResolvedValue({
        id: 'code-1',
        userId: 'u1',
        user: { email: 'Owner@Example.com' },
      });

      await expect(
        service.validateReferralCode('AB12CD34', '  owner@example.com '),
      ).rejects.toThrow('You cannot use your own referral code');
    });
  });

  describe('applyReferralAtSignup', () => {
    it('rejects an invalid code', async () => {
      prisma.referralCode.findUnique.mockResolvedValue(null);

      await expect(
        service.applyReferralAtSignup('new-user', 'bad'),
      ).rejects.toThrow('Referral code is invalid');
      expect(prisma.referral.create).not.toHaveBeenCalled();
    });

    it('records the relationship with the reward not yet granted', async () => {
      prisma.referralCode.findUnique.mockResolvedValue({
        id: 'code-1',
        userId: 'referrer-1',
      });
      prisma.referral.create.mockResolvedValue({});

      await service.applyReferralAtSignup('new-user', ' ab12 ');

      expect(prisma.referral.create).toHaveBeenCalledWith({
        data: {
          referralCodeId: 'code-1',
          referrerId: 'referrer-1',
          referredUserId: 'new-user',
          rewardGranted: false,
        },
      });
    });

    it('refuses a self-referral', async () => {
      prisma.referralCode.findUnique.mockResolvedValue({
        id: 'code-1',
        userId: 'same',
      });

      await expect(
        service.applyReferralAtSignup('same', 'AB12'),
      ).rejects.toThrow('Cannot refer yourself');
      expect(prisma.referral.create).not.toHaveBeenCalled();
    });

    it('turns a duplicate relationship into a clear error', async () => {
      prisma.referralCode.findUnique.mockResolvedValue({
        id: 'code-1',
        userId: 'referrer-1',
      });
      prisma.referral.create.mockRejectedValue(known('P2002'));

      await expect(
        service.applyReferralAtSignup('new-user', 'AB12'),
      ).rejects.toThrow('This user already has a referral relationship');
    });

    it('rethrows any other database error', async () => {
      prisma.referralCode.findUnique.mockResolvedValue({
        id: 'code-1',
        userId: 'referrer-1',
      });
      prisma.referral.create.mockRejectedValue(new Error('timeout'));

      await expect(
        service.applyReferralAtSignup('new-user', 'AB12'),
      ).rejects.toThrow('timeout');
    });
  });

  describe('applyReferralAtSignupById', () => {
    it('writes through the caller transaction, not the shared client', async () => {
      tx.referral.create.mockResolvedValue({});

      await service.applyReferralAtSignupById(tx, 'new-user', 'code-1', 'r1');

      expect(tx.referral.create).toHaveBeenCalledTimes(1);
      expect(prisma.referral.create).not.toHaveBeenCalled();
    });
  });

  describe('grantReferralRewards', () => {
    const referral = {
      id: 'ref-1',
      referrerId: 'referrer-1',
      rewardGranted: false,
    };
    const wallets = [
      { id: 'w-referred', userId: 'referred-1' },
      { id: 'w-referrer', userId: 'referrer-1' },
    ];

    function arrange(
      totalAmount: string,
      overrides: Record<string, unknown> = {},
    ) {
      tx.referral.findUnique.mockResolvedValue(referral);
      tx.order.findFirst.mockResolvedValue({
        totalAmount: new Prisma.Decimal(totalAmount),
      });
      tx.userWallet.findMany.mockResolvedValue(wallets);
      tx.referral.updateMany.mockResolvedValue({ count: 1 });
      tx.user.findUnique.mockResolvedValue({
        email: 'referrer@example.com',
        firstName: 'Ada',
        lastName: 'Obi',
      });
      Object.assign(tx, overrides);
    }

    it('does nothing when the user was not referred', async () => {
      tx.referral.findUnique.mockResolvedValue(null);

      await service.grantReferralRewards('order-1', 'referred-1');

      expect(tx.order.findFirst).not.toHaveBeenCalled();
      expect(tx.userWallet.update).not.toHaveBeenCalled();
    });

    it('does nothing when the reward was already granted', async () => {
      tx.referral.findUnique.mockResolvedValue({
        ...referral,
        rewardGranted: true,
      });

      await service.grantReferralRewards('order-1', 'referred-1');

      expect(tx.userWallet.update).not.toHaveBeenCalled();
    });

    it('requires a delivered order that belongs to the referred user', async () => {
      tx.referral.findUnique.mockResolvedValue(referral);
      tx.order.findFirst.mockResolvedValue(null);

      await expect(
        service.grantReferralRewards('order-1', 'referred-1'),
      ).rejects.toThrow(NotFoundException);
      expect(tx.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-1', userId: 'referred-1', status: 'DELIVERED' },
        }),
      );
      expect(tx.referral.updateMany).not.toHaveBeenCalled();
    });

    it('fails the whole transaction when a wallet is missing', async () => {
      arrange('10000');
      tx.userWallet.findMany.mockResolvedValue([wallets[0]]);

      await expect(
        service.grantReferralRewards('order-1', 'referred-1'),
      ).rejects.toThrow('Referral wallet(s) could not be found');
      expect(tx.referral.updateMany).not.toHaveBeenCalled();
      expect(tx.userWallet.update).not.toHaveBeenCalled();
    });

    it('credits 10% to the referred user and 5% to the referrer, with ledger entries', async () => {
      arrange('20000');

      await service.grantReferralRewards('order-1', 'referred-1');

      expect(tx.referral.updateMany).toHaveBeenCalledWith({
        where: { id: 'ref-1', rewardGranted: false },
        data: { rewardGranted: true },
      });
      const updates = tx.userWallet.update.mock.calls.map((c: any[]) => ({
        id: c[0].where.id,
        amount: c[0].data.balance.increment.toString(),
      }));
      expect(updates).toEqual([
        { id: 'w-referred', amount: '2000' },
        { id: 'w-referrer', amount: '1000' },
      ]);
      const ledger = tx.walletTransaction.create.mock.calls.map(
        (c: any[]) => c[0].data,
      );
      expect(ledger).toHaveLength(2);
      for (const entry of ledger) {
        expect(entry.type).toBe(WalletTransactionType.CREDIT);
        expect(entry.reason).toBe(WalletTransactionReason.REFERRAL);
        expect(entry.referenceId).toBe('order-1');
      }
      expect(ledger.map((e: any) => e.userWalletId)).toEqual([
        'w-referred',
        'w-referrer',
      ]);
    });

    it('caps the referred reward at 5000 and the referrer reward at 10000', async () => {
      arrange('10000000');

      await service.grantReferralRewards('order-1', 'referred-1');

      const amounts = tx.userWallet.update.mock.calls.map((c: any[]) =>
        c[0].data.balance.increment.toString(),
      );
      expect(amounts).toEqual(['5000', '10000']);
    });

    it('rounds to two decimal places and never uses floating point', async () => {
      arrange('333.33');

      await service.grantReferralRewards('order-1', 'referred-1');

      const amounts = tx.userWallet.update.mock.calls.map((c: any[]) =>
        c[0].data.balance.increment.toString(),
      );
      expect(amounts).toEqual(['33.33', '16.67']);
    });

    it('skips a credit that rounds to zero', async () => {
      arrange('0.04');

      await service.grantReferralRewards('order-1', 'referred-1');

      expect(tx.userWallet.update).not.toHaveBeenCalled();
      expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    });

    it('publishes referral.reward_credited in the same transaction as the credits, then wakes the relay', async () => {
      arrange('20000');
      const order: string[] = [];
      tx.walletTransaction.create.mockImplementation(() => {
        order.push('credit');
        return Promise.resolve({});
      });
      outbox.appendEnvelope.mockImplementation(() => {
        order.push('event');
        return Promise.resolve('e-1');
      });
      outbox.wakeRelay.mockImplementation(() => order.push('wake'));
      prisma.$transaction.mockImplementation(
        async (cb: (t: any) => Promise<unknown>) => {
          const result = await cb(tx);
          order.push('commit');
          return result;
        },
      );

      await service.grantReferralRewards('order-1', 'referred-1');

      expect(outbox.appendEnvelope).toHaveBeenCalledWith(
        tx,
        {
          type: 'referral.reward_credited',
          aggregate: { type: 'referral', id: 'ref-1' },
          payload: {
            referralId: 'ref-1',
            referrerId: 'referrer-1',
            referrerEmail: 'referrer@example.com',
            referrerName: 'Ada Obi',
            referredUserId: 'referred-1',
            orderId: 'order-1',
            rewardAmount: 1000,
            referredRewardAmount: 2000,
            currency: 'NGN',
          },
        },
        { wakeRelay: false },
      );
      expect(order).toEqual(['credit', 'credit', 'event', 'commit', 'wake']);
    });

    it('publishes nothing when the reward was already granted or claimed by another request', async () => {
      arrange('20000');
      tx.referral.updateMany.mockResolvedValue({ count: 0 });

      await service.grantReferralRewards('order-1', 'referred-1');

      expect(outbox.appendEnvelope).not.toHaveBeenCalled();
    });

    it('publishes nothing, and wakes nothing, when the transaction fails', async () => {
      arrange('20000');
      tx.userWallet.findMany.mockResolvedValue([wallets[0]]);

      await expect(
        service.grantReferralRewards('order-1', 'referred-1'),
      ).rejects.toThrow();
      expect(outbox.appendEnvelope).not.toHaveBeenCalled();
      expect(outbox.wakeRelay).not.toHaveBeenCalled();
    });

    it('pays nothing when another request claimed the reward first', async () => {
      arrange('20000');
      tx.referral.updateMany.mockResolvedValue({ count: 0 });

      await service.grantReferralRewards('order-1', 'referred-1');

      expect(tx.userWallet.update).not.toHaveBeenCalled();
      expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    });

    it('runs at Serializable isolation with bounded waits', async () => {
      arrange('20000');

      await service.grantReferralRewards('order-1', 'referred-1');

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      });
    });

    it('retries a serialization conflict and then succeeds', async () => {
      arrange('20000');
      prisma.$transaction
        .mockRejectedValueOnce(known('P2034'))
        .mockImplementationOnce((cb: (t: any) => Promise<unknown>) => cb(tx));

      await service.grantReferralRewards('order-1', 'referred-1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(tx.userWallet.update).toHaveBeenCalledTimes(2);
    });

    it('gives up after three conflicts and surfaces the error', async () => {
      prisma.$transaction.mockRejectedValue(known('P2034'));

      await expect(
        service.grantReferralRewards('order-1', 'referred-1'),
      ).rejects.toMatchObject({ code: 'P2034' });
      expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    });

    it('does not retry an error that is not a conflict', async () => {
      prisma.$transaction.mockRejectedValue(new Error('disk full'));

      await expect(
        service.grantReferralRewards('order-1', 'referred-1'),
      ).rejects.toThrow('disk full');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('lookups', () => {
    it('getUnrewardedReferral returns the referral only while the reward is pending', async () => {
      prisma.referral.findUnique
        .mockResolvedValueOnce({
          id: 'r1',
          referrerId: 'x',
          rewardGranted: false,
        })
        .mockResolvedValueOnce({
          id: 'r1',
          referrerId: 'x',
          rewardGranted: true,
        })
        .mockResolvedValueOnce(null);

      await expect(service.getUnrewardedReferral('u')).resolves.toEqual({
        id: 'r1',
        referrerId: 'x',
      });
      await expect(service.getUnrewardedReferral('u')).resolves.toBeNull();
      await expect(service.getUnrewardedReferral('u')).resolves.toBeNull();
    });

    it('hasPendingReferral is true only for a referral whose reward is not granted', async () => {
      prisma.referral.findUnique
        .mockResolvedValueOnce({ rewardGranted: false })
        .mockResolvedValueOnce({ rewardGranted: true })
        .mockResolvedValueOnce(null);

      await expect(service.hasPendingReferral('u')).resolves.toBe(true);
      await expect(service.hasPendingReferral('u')).resolves.toBe(false);
      await expect(service.hasPendingReferral('u')).resolves.toBe(false);
    });
  });
});
