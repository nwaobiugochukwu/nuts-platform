import { BrokenCircuitError } from 'cockatiel';
import { CircuitBreakerService } from './circuit-breaker.service';

describe('CircuitBreakerService', () => {
  let service: CircuitBreakerService;

  beforeEach(() => {
    service = new CircuitBreakerService();
  });

  describe('Initial state', () => {
    it('initializes all circuits in CLOSED state', () => {
      const status = service.getStatus();
      expect(status.paystack).toBe('CLOSED');
      expect(status.email).toBe('CLOSED');
      expect(status.cloudinary).toBe('CLOSED');
    });
  });

  describe('executePaystack resilience', () => {
    it('executes successful calls normally', async () => {
      const result = await service.executePaystack(() =>
        Promise.resolve('paystack-ok'),
      );
      expect(result).toBe('paystack-ok');
      expect(service.getStatus().paystack).toBe('CLOSED');
    });

    it('trips the breaker OPEN after 3 consecutive failures and fails fast', async () => {
      const failingFn = jest.fn(() =>
        Promise.reject(new Error('Paystack gateway timeout')),
      );

      // 3 consecutive failures
      for (let i = 0; i < 3; i++) {
        await expect(service.executePaystack(failingFn)).rejects.toThrow(
          'Paystack gateway timeout',
        );
      }

      // Circuit should now be OPEN
      expect(service.getStatus().paystack).toBe('OPEN');

      // Subsequent call should fail fast with BrokenCircuitError without executing the function
      failingFn.mockClear();
      await expect(service.executePaystack(failingFn)).rejects.toThrow(
        BrokenCircuitError,
      );
      expect(failingFn).not.toHaveBeenCalled();
    });
  });

  describe('executeEmail', () => {
    it('executes email provider calls normally', async () => {
      const result = await service.executeEmail(() =>
        Promise.resolve('email-ok'),
      );

      expect(result).toBe('email-ok');
      expect(service.getStatus().email).toBe('CLOSED');
    });
  });
});
