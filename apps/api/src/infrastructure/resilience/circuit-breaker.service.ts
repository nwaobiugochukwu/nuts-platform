import { Injectable, Logger } from '@nestjs/common';
import {
  circuitBreaker,
  CircuitState,
  ConsecutiveBreaker,
  handleAll,
  timeout,
  TimeoutStrategy,
  wrap,
} from 'cockatiel';

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);

  // Paystack Policy: 3 consecutive failures trips the breaker, reset after 10s
  private readonly paystackCircuit = circuitBreaker(handleAll, {
    halfOpenAfter: 10_000,
    breaker: new ConsecutiveBreaker(3),
  });
  private readonly paystackTimeout = timeout(8_000, TimeoutStrategy.Aggressive);
  private readonly paystackPolicy = wrap(
    this.paystackTimeout,
    this.paystackCircuit,
  );

  // Email API policy: 3 consecutive failures trips the breaker, reset after 30s
  private readonly emailCircuit = circuitBreaker(handleAll, {
    halfOpenAfter: 30_000,
    breaker: new ConsecutiveBreaker(3),
  });
  private readonly emailTimeout = timeout(10_000, TimeoutStrategy.Aggressive);
  private readonly emailPolicy = wrap(this.emailTimeout, this.emailCircuit);

  // Cloudinary Policy: 3 consecutive failures trips the breaker, reset after 15s
  private readonly cloudinaryCircuit = circuitBreaker(handleAll, {
    halfOpenAfter: 15_000,
    breaker: new ConsecutiveBreaker(3),
  });
  private readonly cloudinaryTimeout = timeout(
    15_000,
    TimeoutStrategy.Aggressive,
  );
  private readonly cloudinaryPolicy = wrap(
    this.cloudinaryTimeout,
    this.cloudinaryCircuit,
  );

  constructor() {
    this.paystackCircuit.onBreak(() =>
      this.logger.error('CRITICAL: Paystack Circuit Breaker tripped OPEN!'),
    );
    this.paystackCircuit.onReset(() =>
      this.logger.log('Paystack Circuit Breaker RESET to CLOSED.'),
    );

    this.emailCircuit.onBreak(() =>
      this.logger.error('CRITICAL: Email Circuit Breaker tripped OPEN!'),
    );
    this.emailCircuit.onReset(() =>
      this.logger.log('Email Circuit Breaker RESET to CLOSED.'),
    );

    this.cloudinaryCircuit.onBreak(() =>
      this.logger.error('CRITICAL: Cloudinary Circuit Breaker tripped OPEN!'),
    );
    this.cloudinaryCircuit.onReset(() =>
      this.logger.log('Cloudinary Circuit Breaker RESET to CLOSED.'),
    );
  }

  public async executePaystack<T>(fn: () => Promise<T>): Promise<T> {
    return this.paystackPolicy.execute(fn);
  }

  public async executeEmail<T>(fn: () => Promise<T>): Promise<T> {
    return this.emailPolicy.execute(fn);
  }

  public async executeCloudinary<T>(fn: () => Promise<T>): Promise<T> {
    return this.cloudinaryPolicy.execute(fn);
  }

  public getStatus() {
    return {
      paystack:
        this.paystackCircuit.state === CircuitState.Closed ? 'CLOSED' : 'OPEN',
      email:
        this.emailCircuit.state === CircuitState.Closed ? 'CLOSED' : 'OPEN',
      cloudinary:
        this.cloudinaryCircuit.state === CircuitState.Closed
          ? 'CLOSED'
          : 'OPEN',
    };
  }
}
