import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  PAYSTACK_TRANSACTION_VERIFY_BASE_URL,
  PAYSTACK_WEBHOOK_CRYPTO_ALGO,
} from '@api/common/constants/payment.constants';
import { CircuitBreakerService } from '@api/infrastructure/resilience/circuit-breaker.service';
import { withUpstreamStatus } from '@api/infrastructure/resilience/dependency-failure.util';
import type {
  PaystackApiResponse,
  PaystackVerifyData,
} from '../types/paystack.types';

/**
 * Everything that talks to Paystack, or checks something Paystack sent: the HTTP calls (through
 * the Paystack circuit breaker, with a timeout), the response handling that keeps the real
 * upstream status, and the webhook signature check. It holds no business rules; the payment code
 * decides what the answers mean.
 */
@Injectable()
export class PaystackClientService {
  private readonly logger = new Logger(PaystackClientService.name);

  /**
   * External API timeout.
   *
   * Without an explicit timeout, an unavailable Paystack connection can
   * leave an HTTP request hanging for an unnecessarily long period.
   */
  private readonly paystackTimeoutMs = 10_000;

  constructor(
    private readonly config: ConfigService,
    private readonly circuitBreaker: CircuitBreakerService,
  ) {}

  async verifyTransaction(
    reference: string,
  ): Promise<PaystackApiResponse<PaystackVerifyData> | null> {
    const url =
      `${PAYSTACK_TRANSACTION_VERIFY_BASE_URL}/` +
      `${encodeURIComponent(reference)}`;

    try {
      return await this.get<PaystackApiResponse<PaystackVerifyData>>(url);
    } catch (error) {
      this.logger.error('Paystack verification request failed', error);

      return null;
    }
  }

  async post<T>(url: string, body: unknown): Promise<T> {
    return this.circuitBreaker.executePaystack(async () => {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.paystackTimeoutMs),
      });

      return this.parseResponse<T>(response);
    });
  }

  async get<T>(url: string): Promise<T> {
    // A read: safe to repeat, so a flaky Paystack is retried with backoff before giving up.
    return this.circuitBreaker.executePaystackRepeatable(async () => {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.headers(),
        signal: AbortSignal.timeout(this.paystackTimeoutMs),
      });

      return this.parseResponse<T>(response);
    });
  }

  private headers(): Record<string, string> {
    const secretKey = this.config
      .getOrThrow<string>('PAYSTACK_SECRET_KEY')
      .trim();

    if (!secretKey) {
      throw new InternalServerErrorException('Paystack is not configured.');
    }

    return {
      Authorization: `Bearer ${secretKey}`,

      'Content-Type': 'application/json',
    };
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    const rawText = await response.text();

    let data: T;

    try {
      data = JSON.parse(rawText) as T;
    } catch {
      this.logger.error('Paystack returned invalid JSON.');

      throw new ServiceUnavailableException('Invalid Paystack API response.');
    }

    if (!response.ok) {
      const rawMessage =
        typeof data === 'object' &&
        data !== null &&
        'message' in data &&
        typeof (
          data as {
            message?: unknown;
          }
        ).message === 'string'
          ? (
              data as {
                message: string;
              }
            ).message
          : `Paystack returned HTTP ${response.status}.`;

      const authenticationError =
        response.status === 401 ||
        response.status === 403 ||
        /invalid\s*key/i.test(rawMessage);

      if (authenticationError) {
        this.logger.error('Paystack authentication failed.');

        throw withUpstreamStatus(
          new ServiceUnavailableException(
            'Paystack authentication failed. Check PAYSTACK_SECRET_KEY.',
          ),
          response.status,
        );
      }

      // The caller still gets a 503; the breaker sees the status Paystack really returned.
      throw withUpstreamStatus(
        new ServiceUnavailableException(rawMessage),
        response.status,
      );
    }

    return data;
  }

  // ---------------------------------------------------------------------------
  // SECURITY
  // ---------------------------------------------------------------------------

  isValidWebhookSignature(rawBody: string, signature: string): boolean {
    try {
      const secret = this.config
        .getOrThrow<string>('PAYSTACK_SECRET_KEY')
        .trim();

      const expected = createHmac(PAYSTACK_WEBHOOK_CRYPTO_ALGO, secret)
        .update(rawBody)
        .digest('hex');

      const receivedBuffer = Buffer.from(signature.trim(), 'utf8');

      const expectedBuffer = Buffer.from(expected, 'utf8');

      if (receivedBuffer.length !== expectedBuffer.length) {
        return false;
      }

      return timingSafeEqual(receivedBuffer, expectedBuffer);
    } catch {
      return false;
    }
  }

  assertConfigured(): void {
    const key = this.config.get<string>('PAYSTACK_SECRET_KEY')?.trim();

    if (!key) {
      throw new InternalServerErrorException('Paystack is not configured.');
    }
  }
}
