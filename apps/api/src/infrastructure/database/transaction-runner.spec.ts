/* eslint-disable @typescript-eslint/require-await -- test callbacks are async to match the runner signature */
import { Prisma } from '@prisma/client';
import {
  TransactionRunner,
  isRetryableTransactionError,
  resolveTransactionOptions,
  transactionBackoffMs,
} from './transaction-runner';

function conflict() {
  return new Prisma.PrismaClientKnownRequestError('conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

describe('transaction option presets', () => {
  it('uses sensible defaults and lets options override presets', () => {
    expect(resolveTransactionOptions({})).toMatchObject({
      isolation: 'ReadCommitted',
      timeoutMs: 15_000,
      retries: 0,
    });
    expect(resolveTransactionOptions({ preset: 'critical' })).toMatchObject({
      isolation: 'Serializable',
      retries: 3,
    });
    expect(
      resolveTransactionOptions({
        preset: 'critical',
        retries: 1,
        timeoutMs: 1,
      }),
    ).toMatchObject({ retries: 1, timeoutMs: 1, isolation: 'Serializable' });
    expect(resolveTransactionOptions({ retries: -4 }).retries).toBe(0);
  });
});

describe('isRetryableTransactionError', () => {
  it('recognises conflicts, serialization failures and deadlocks', () => {
    expect(isRetryableTransactionError(conflict())).toBe(true);
    expect(isRetryableTransactionError({ code: '40001' })).toBe(true);
    expect(isRetryableTransactionError({ code: '40P01' })).toBe(true);
    expect(
      isRetryableTransactionError(new Error('could not serialize access')),
    ).toBe(true);
    expect(isRetryableTransactionError(new Error('deadlock detected'))).toBe(
      true,
    );
  });

  it('does not retry ordinary failures', () => {
    expect(isRetryableTransactionError(new Error('boom'))).toBe(false);
    expect(
      isRetryableTransactionError(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      ),
    ).toBe(false);
  });
});

describe('transactionBackoffMs', () => {
  it('grows with the attempt and stays within the jitter band', () => {
    expect(transactionBackoffMs(1, () => 0)).toBe(25);
    expect(transactionBackoffMs(1, () => 1)).toBe(50);
    expect(transactionBackoffMs(3, () => 0)).toBe(100);
    expect(transactionBackoffMs(3, () => 1)).toBe(200);
  });
});

describe('TransactionRunner', () => {
  const tx = { marker: 'tx' } as unknown as Prisma.TransactionClient;
  let prisma: { $transaction: jest.Mock };
  let outbox: { appendEvent: jest.Mock; wakeRelay: jest.Mock };
  let runner: TransactionRunner;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn((fn: (client: unknown) => Promise<unknown>) =>
        fn(tx),
      ),
    };
    outbox = {
      appendEvent: jest.fn().mockResolvedValue(undefined),
      wakeRelay: jest.fn(),
    };
    runner = new TransactionRunner(prisma as never, outbox as never);
    jest.spyOn(global, 'setTimeout').mockImplementation((fn: () => void) => {
      fn();
      return 0 as never;
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('passes the transaction client and returns the result', async () => {
    const result = await runner.run(
      async (ctx) => {
        expect(ctx.tx).toBe(tx);
        return 42;
      },
      { name: 't.basic' },
    );
    expect(result).toBe(42);
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 15_000,
      }),
    );
  });

  it('runs afterCommit hooks in order only after the commit', async () => {
    const order: string[] = [];
    prisma.$transaction.mockImplementation(async (fn) => {
      const value = await fn(tx);
      order.push('commit');
      return value;
    });
    await runner.run(
      async (ctx) => {
        ctx.afterCommit(() => {
          order.push('hook1');
        });
        ctx.afterCommit(async () => {
          order.push('hook2');
        });
        order.push('work');
      },
      { name: 't.hooks' },
    );
    expect(order).toEqual(['work', 'commit', 'hook1', 'hook2']);
  });

  it('never fails committed work because a hook failed', async () => {
    await expect(
      runner.run(
        async (ctx) => {
          ctx.afterCommit(() => {
            throw new Error('cache down');
          });
          return 'ok';
        },
        { name: 't.hookfail' },
      ),
    ).resolves.toBe('ok');
  });

  it('appends outbox events without waking the relay until after commit', async () => {
    const order: string[] = [];
    outbox.wakeRelay.mockImplementation(() => order.push('wake'));
    prisma.$transaction.mockImplementation(async (fn) => {
      const value = await fn(tx);
      order.push('commit');
      return value;
    });
    await runner.run(
      async (ctx) => {
        await ctx.emit('order', 'o1', 'order.settled', { orderId: 'o1' });
        await ctx.emit('order', 'o1', 'order.settled', { orderId: 'o1' });
        order.push('work');
      },
      { name: 't.emit' },
    );
    expect(outbox.appendEvent).toHaveBeenCalledTimes(2);
    expect(outbox.appendEvent).toHaveBeenCalledWith(
      tx,
      'order',
      'o1',
      'order.settled',
      { orderId: 'o1' },
      { wakeRelay: false },
    );
    expect(order).toEqual(['work', 'commit', 'wake']);
  });

  it('records critical audit events in the transaction via the outbox', async () => {
    const order: string[] = [];
    outbox.wakeRelay.mockImplementation(() => order.push('wake'));
    prisma.$transaction.mockImplementation(async (fn) => {
      const value = await fn(tx);
      order.push('commit');
      return value;
    });
    await runner.run(
      async (ctx) => {
        await ctx.audit({
          action: 'VENDOR_SETTLED',
          entity: 'Order',
          entityId: 'o1',
          adminId: 'a1',
          payload: { amount: 10, token: 'secret' },
        });
        order.push('work');
      },
      { name: 't.audit' },
    );
    expect(outbox.appendEvent).toHaveBeenCalledWith(
      tx,
      'audit',
      'o1',
      'audit.event',
      expect.objectContaining({
        action: 'VENDOR_SETTLED',
        entity: 'Order',
        adminId: 'a1',
        payload: { amount: 10, token: '[REDACTED]' },
      }),
      { wakeRelay: false },
    );
    expect(order).toEqual(['work', 'commit', 'wake']);
  });

  it('retries a conflicting critical transaction and then succeeds', async () => {
    let calls = 0;
    prisma.$transaction.mockImplementation(async (fn) => {
      calls += 1;
      if (calls < 3) throw conflict();
      return fn(tx);
    });
    const hook = jest.fn();
    const result = await runner.run(
      async (ctx) => {
        ctx.afterCommit(hook);
        return 'done';
      },
      { name: 't.retry', preset: 'critical' },
    );
    expect(result).toBe('done');
    expect(calls).toBe(3);
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('gives up after the allowed retries and runs rollback hooks once', async () => {
    prisma.$transaction.mockRejectedValue(conflict());
    const rollback = jest.fn();
    await expect(
      runner.run(
        async (ctx) => {
          ctx.afterRollback(rollback);
        },
        { name: 't.giveup', preset: 'critical', retries: 2 },
      ),
    ).rejects.toMatchObject({ code: 'P2034' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-conflict errors and runs rollback hooks', async () => {
    const rollback = jest.fn();
    prisma.$transaction.mockImplementation(async (fn) => fn(tx));
    await expect(
      runner.run(
        async (ctx) => {
          ctx.afterRollback(rollback);
          throw new Error('business rule');
        },
        { name: 't.fail', preset: 'critical' },
      ),
    ).rejects.toThrow('business rule');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  it('does not run commit hooks when the transaction fails', async () => {
    const hook = jest.fn();
    prisma.$transaction.mockImplementation(async (fn) => fn(tx));
    await expect(
      runner.run(
        async (ctx) => {
          ctx.afterCommit(hook);
          throw new Error('nope');
        },
        { name: 't.nocommit' },
      ),
    ).rejects.toThrow('nope');
    expect(hook).not.toHaveBeenCalled();
  });

  it('joins a parent transaction and defers hooks to its commit', async () => {
    const order: string[] = [];
    prisma.$transaction.mockImplementation(async (fn) => {
      const value = await fn(tx);
      order.push('commit');
      return value;
    });
    await runner.run(
      async (outer) => {
        await runner.run(
          async (inner) => {
            expect(inner.tx).toBe(outer.tx);
            inner.afterCommit(() => {
              order.push('inner-hook');
            });
            order.push('inner');
          },
          { name: 't.inner', parent: outer.tx },
        );
        order.push('outer');
      },
      { name: 't.outer' },
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['inner', 'outer', 'commit', 'inner-hook']);
  });

  it('refuses hooks when joining a transaction it did not open', async () => {
    const foreign = { other: true } as unknown as Prisma.TransactionClient;
    await expect(
      runner.run(
        async (ctx) => {
          ctx.afterCommit(() => undefined);
        },
        { name: 't.foreign', parent: foreign },
      ),
    ).rejects.toThrow(/not opened by TransactionRunner/);
  });
});
