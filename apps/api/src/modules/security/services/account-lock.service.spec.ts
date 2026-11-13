import Redis from 'ioredis';
import { SECURITY } from '@api/common/constants';
import { AccountLockService } from './account-lock.service';

describe('AccountLockService', () => {
  let service: AccountLockService;
  let mockRedis: jest.Mocked<Partial<Redis>>;

  beforeEach(() => {
    mockRedis = {
      incr: jest.fn(),
      expire: jest.fn(),
      ttl: jest.fn(),
      get: jest.fn(),
      setex: jest.fn(),
      del: jest.fn(),
    };

    service = new AccountLockService(mockRedis as unknown as Redis);
  });

  describe('recordFailedAttempt', () => {
    it('sets TTL on the first failed attempt', async () => {
      (mockRedis.incr as jest.Mock).mockResolvedValue(1);
      (mockRedis.expire as jest.Mock).mockResolvedValue(1);

      const attempts = await service.recordFailedAttempt('test@example.com');

      expect(attempts).toBe(1);
      expect(mockRedis.incr).toHaveBeenCalledWith(
        expect.stringContaining('login:attempts:'),
      );
      expect(mockRedis.expire).toHaveBeenCalledWith(
        expect.stringContaining('login:attempts:'),
        SECURITY.LOCKOUT_DURATION_MINUTES * 60,
      );
      expect(mockRedis.setex).not.toHaveBeenCalled();
    });

    it('heals missing TTL if key has no TTL on subsequent attempt', async () => {
      (mockRedis.incr as jest.Mock).mockResolvedValue(2);
      (mockRedis.ttl as jest.Mock).mockResolvedValue(-1); // -1 means no TTL
      (mockRedis.expire as jest.Mock).mockResolvedValue(1);

      const attempts = await service.recordFailedAttempt('test@example.com');

      expect(attempts).toBe(2);
      expect(mockRedis.expire).toHaveBeenCalledWith(
        expect.stringContaining('login:attempts:'),
        SECURITY.LOCKOUT_DURATION_MINUTES * 60,
      );
    });

    it('locks account and resets attempt counter when reaching MAX_LOGIN_ATTEMPTS', async () => {
      (mockRedis.incr as jest.Mock).mockResolvedValue(
        SECURITY.MAX_LOGIN_ATTEMPTS,
      );
      (mockRedis.ttl as jest.Mock).mockResolvedValue(300);
      (mockRedis.setex as jest.Mock).mockResolvedValue('OK');
      (mockRedis.del as jest.Mock).mockResolvedValue(1);

      const attempts = await service.recordFailedAttempt('test@example.com');

      expect(attempts).toBe(SECURITY.MAX_LOGIN_ATTEMPTS);
      expect(mockRedis.setex).toHaveBeenCalledWith(
        expect.stringContaining('login:locked:'),
        SECURITY.LOCKOUT_DURATION_MINUTES * 60,
        '1',
      );
      // Confirms attempt counter was deleted to prevent immediate re-lock after lockout expires
      expect(mockRedis.del).toHaveBeenCalledWith(
        expect.stringContaining('login:attempts:'),
      );
    });
  });

  describe('isLocked', () => {
    it('returns true when lock key exists in Redis', async () => {
      (mockRedis.get as jest.Mock).mockResolvedValue('1');

      const locked = await service.isLocked('test@example.com');
      expect(locked).toBe(true);
    });

    it('returns false when lock key does not exist', async () => {
      (mockRedis.get as jest.Mock).mockResolvedValue(null);

      const locked = await service.isLocked('test@example.com');
      expect(locked).toBe(false);
    });
  });

  describe('getLockoutTimeRemaining', () => {
    it('returns remaining TTL in seconds', async () => {
      (mockRedis.ttl as jest.Mock).mockResolvedValue(450);

      const remaining =
        await service.getLockoutTimeRemaining('test@example.com');
      expect(remaining).toBe(450);
    });

    it('returns 0 when key has expired or negative TTL', async () => {
      (mockRedis.ttl as jest.Mock).mockResolvedValue(-2);

      const remaining =
        await service.getLockoutTimeRemaining('test@example.com');
      expect(remaining).toBe(0);
    });
  });

  describe('resetAttempts', () => {
    it('deletes attempts key from Redis upon successful login', async () => {
      (mockRedis.del as jest.Mock).mockResolvedValue(1);

      await service.resetAttempts('test@example.com');
      expect(mockRedis.del).toHaveBeenCalledWith(
        expect.stringContaining('login:attempts:'),
      );
    });
  });
});
