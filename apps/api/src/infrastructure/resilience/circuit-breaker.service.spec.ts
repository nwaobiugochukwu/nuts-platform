import { BrokenCircuitError } from 'cockatiel';
import { CircuitBreakerService } from './circuit-breaker.service';

const upstream = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { status });

describe('CircuitBreakerService', () => {
  let service: CircuitBreakerService;

  beforeEach(() => {
    service = new CircuitBreakerService();
    for (const level of ['log', 'error'] as const) {
      jest
        .spyOn((service as any).logger, level)
        .mockImplementation(() => undefined);
    }
  });

  describe('Initial state', () => {
    it('initializes all circuits in CLOSED state', () => {
      expect(service.getStatus()).toEqual({
        paystack: 'CLOSED',
        email: 'CLOSED',
        cloudinary: 'CLOSED',
      });
      expect(service.getStates()).toEqual({
        paystack: 'CLOSED',
        email: 'CLOSED',
        cloudinary: 'CLOSED',
      });
    });
  });

  describe('executePaystack resilience', () => {
    it('executes successful calls normally', async () => {
      await expect(
        service.executePaystack(() => Promise.resolve('paystack-ok')),
      ).resolves.toBe('paystack-ok');
      expect(service.getStatus().paystack).toBe('CLOSED');
    });

    it('trips OPEN after 3 consecutive dependency failures and then fails fast', async () => {
      const failing = jest.fn(() => Promise.reject(upstream(503)));

      for (let i = 0; i < 3; i++) {
        await expect(service.executePaystack(failing)).rejects.toThrow(
          'HTTP 503',
        );
      }
      expect(service.getStatus().paystack).toBe('OPEN');

      failing.mockClear();
      await expect(service.executePaystack(failing)).rejects.toThrow(
        BrokenCircuitError,
      );
      expect(failing).not.toHaveBeenCalled();
    });

    it('does not trip on bad requests or wrong credentials (4xx)', async () => {
      for (const status of [400, 401, 404, 400, 400, 400]) {
        await expect(
          service.executePaystack(() => Promise.reject(upstream(status))),
        ).rejects.toThrow();
      }
      expect(service.getStatus().paystack).toBe('CLOSED');
    });

    it('does not trip on our own bugs (errors with no status or network code)', async () => {
      for (let i = 0; i < 5; i++) {
        await expect(
          service.executePaystack(() => Promise.reject(new TypeError('bug'))),
        ).rejects.toThrow('bug');
      }
      expect(service.getStatus().paystack).toBe('CLOSED');
    });

    it('trips on rate limiting (429) and on network errors', async () => {
      await expect(
        service.executePaystack(() => Promise.reject(upstream(429))),
      ).rejects.toThrow();
      await expect(
        service.executePaystack(() =>
          Promise.reject(Object.assign(new Error('x'), { code: 'ECONNRESET' })),
        ),
      ).rejects.toThrow();
      await expect(
        service.executePaystack(() => Promise.reject(upstream(500))),
      ).rejects.toThrow();
      expect(service.getStates().paystack).toBe('OPEN');
    });

    it('counts consecutive failures only: a success in between resets the count', async () => {
      await expect(
        service.executePaystack(() => Promise.reject(upstream(503))),
      ).rejects.toThrow();
      await expect(
        service.executePaystack(() => Promise.reject(upstream(503))),
      ).rejects.toThrow();
      await expect(
        service.executePaystack(() => Promise.resolve('ok')),
      ).resolves.toBe('ok');
      await expect(
        service.executePaystack(() => Promise.reject(upstream(503))),
      ).rejects.toThrow();
      expect(service.getStatus().paystack).toBe('CLOSED');
    });
  });

  describe('repeatable calls', () => {
    it('retries a dependency failure with backoff and succeeds when the dependency recovers', async () => {
      const flaky = jest
        .fn()
        .mockRejectedValueOnce(upstream(502))
        .mockResolvedValue('recovered');

      await expect(service.executePaystackRepeatable(flaky)).resolves.toBe(
        'recovered',
      );
      expect(flaky).toHaveBeenCalledTimes(2);
    });

    it('does not retry a bad request', async () => {
      const bad = jest.fn(() => Promise.reject(upstream(400)));

      await expect(service.executePaystackRepeatable(bad)).rejects.toThrow();
      expect(bad).toHaveBeenCalledTimes(1);
    });

    it('does not retry while the circuit is open', async () => {
      const failing = jest.fn(() => Promise.reject(upstream(503)));
      for (let i = 0; i < 3; i++) {
        await service.executePaystack(failing).catch(() => undefined);
      }
      failing.mockClear();

      await expect(service.executePaystackRepeatable(failing)).rejects.toThrow(
        BrokenCircuitError,
      );
      expect(failing).not.toHaveBeenCalled();
    });

    it('gives up after three tries', async () => {
      const down = jest.fn(() => Promise.reject(upstream(503)));

      await expect(service.executeCloudinaryRepeatable(down)).rejects.toThrow(
        'HTTP 503',
      );
      expect(down).toHaveBeenCalledTimes(3);
    });
  });

  describe('executeEmail and executeCloudinary', () => {
    it('executes calls normally', async () => {
      await expect(
        service.executeEmail(() => Promise.resolve('email-ok')),
      ).resolves.toBe('email-ok');
      await expect(
        service.executeCloudinary(() => Promise.resolve('img-ok')),
      ).resolves.toBe('img-ok');
      expect(service.getStatus().email).toBe('CLOSED');
    });

    it('trips the Cloudinary breaker on consecutive upstream failures', async () => {
      for (let i = 0; i < 3; i++) {
        await service
          .executeCloudinary(() => Promise.reject(upstream(502)))
          .catch(() => undefined);
      }
      expect(service.getStates().cloudinary).toBe('OPEN');
      expect(service.getStates().paystack).toBe('CLOSED');
    });
  });
});
