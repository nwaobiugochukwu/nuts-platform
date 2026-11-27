import { Injectable, Logger } from '@nestjs/common';
import {
  circuitBreaker,
  CircuitBreakerPolicy,
  CircuitState,
  ConsecutiveBreaker,
  ExponentialBackoff,
  handleWhen,
  IPolicy,
  retry,
  timeout,
  TimeoutStrategy,
  wrap,
} from 'cockatiel';
import { isDependencyFailure } from './dependency-failure.util';

export type Dependency = 'paystack' | 'email' | 'cloudinary';
export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface Guard {
  circuit: CircuitBreakerPolicy;
  /** timeout inside the breaker, so a timeout counts as a failure of the dependency */
  policy: IPolicy;
  /** the same, plus retries with backoff and jitter, for calls that are safe to repeat */
  repeatablePolicy: IPolicy;
}

/**
 * One circuit breaker per external dependency.
 *
 * - Only timeouts, network errors, HTTP 5xx and 429 count towards tripping a breaker; a
 *   bad request or wrong credentials (4xx) does not ([[isDependencyFailure]]).
 * - The timeout sits inside the breaker, so a call that times out is a recorded failure.
 * - `execute*Repeatable` also retries (3 tries, exponential backoff with jitter) and is only for
 *   calls that are safe to repeat: reads, and deletes of a named object. Never use it for
 *   something that creates or charges.
 * - An open breaker fails fast with `BrokenCircuitError`; queue consumers treat that as "wait
 *   and try again", not as a failed message.
 */
@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);

  private readonly guards: Record<Dependency, Guard> = {
    paystack: this.buildGuard('Paystack', 10_000, 8_000),
    email: this.buildGuard('Email', 30_000, 10_000),
    cloudinary: this.buildGuard('Cloudinary', 15_000, 15_000),
  };

  private buildGuard(
    label: string,
    halfOpenAfterMs: number,
    timeoutMs: number,
  ): Guard {
    const circuit = circuitBreaker(handleWhen(isDependencyFailure), {
      halfOpenAfter: halfOpenAfterMs,
      breaker: new ConsecutiveBreaker(3),
    });
    circuit.onBreak(() =>
      this.logger.error(`CRITICAL: ${label} circuit breaker tripped OPEN!`),
    );
    circuit.onReset(() =>
      this.logger.log(`${label} circuit breaker RESET to CLOSED.`),
    );
    const policy = wrap(
      circuit,
      timeout(timeoutMs, TimeoutStrategy.Aggressive),
    );
    const retries = retry(handleWhen(isDependencyFailure), {
      maxAttempts: 2,
      backoff: new ExponentialBackoff({ initialDelay: 200, maxDelay: 2_000 }),
    });
    return { circuit, policy, repeatablePolicy: wrap(retries, policy) };
  }

  public executePaystack<T>(fn: () => Promise<T>): Promise<T> {
    return this.guards.paystack.policy.execute(fn);
  }

  /** For Paystack reads (verify, lookups): retried with backoff. */
  public executePaystackRepeatable<T>(fn: () => Promise<T>): Promise<T> {
    return this.guards.paystack.repeatablePolicy.execute(fn);
  }

  public executeEmail<T>(fn: () => Promise<T>): Promise<T> {
    return this.guards.email.policy.execute(fn);
  }

  public executeCloudinary<T>(fn: () => Promise<T>): Promise<T> {
    return this.guards.cloudinary.policy.execute(fn);
  }

  /** For Cloudinary calls safe to repeat (deleting a named image): retried with backoff. */
  public executeCloudinaryRepeatable<T>(fn: () => Promise<T>): Promise<T> {
    return this.guards.cloudinary.repeatablePolicy.execute(fn);
  }

  private stateOf(dependency: Dependency): BreakerState {
    switch (this.guards[dependency].circuit.state) {
      case CircuitState.Closed:
        return 'CLOSED';
      case CircuitState.HalfOpen:
        return 'HALF_OPEN';
      default:
        return 'OPEN';
    }
  }

  /** CLOSED or OPEN per dependency (a half-open breaker reports OPEN, as before). */
  public getStatus() {
    const open = (dependency: Dependency) =>
      this.stateOf(dependency) === 'CLOSED' ? 'CLOSED' : 'OPEN';
    return {
      paystack: open('paystack'),
      email: open('email'),
      cloudinary: open('cloudinary'),
    };
  }

  /** The exact state per dependency, for metrics. */
  public getStates(): Record<Dependency, BreakerState> {
    return {
      paystack: this.stateOf('paystack'),
      email: this.stateOf('email'),
      cloudinary: this.stateOf('cloudinary'),
    };
  }
}
