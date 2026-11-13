import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomInt } from 'crypto';
import Redis from 'ioredis';

import { EmailService } from '@api/infrastructure/mail/email.service';

export type OtpPurpose =
  | 'registration'
  | 'payment'
  | 'password-reset'
  | 'email-verification'
  | 'account-deactivation'
  | 'admin:action'
  | 'vendor:registration'
  | 'vendor:password-reset';

type CreateOtpOptions = {
  subject?: string;
  orderDetails?: string;
  eyebrow?: string;
  title?: string;
  description?: string;
};

/**
 * The Lua script verifies and consumes the OTP atomically.
 *
 * This prevents two concurrent verification requests from both accepting
 * the same OTP before either request deletes it.
 */
const VERIFY_OTP_SCRIPT = `
  local otp = redis.call('GET', KEYS[1])

  if not otp then
    return -1
  end

  local attempts =
    tonumber(redis.call('GET', KEYS[2]) or '0')

  if attempts >= tonumber(ARGV[2]) then
    redis.call('DEL', KEYS[1])
    redis.call('DEL', KEYS[2])
    return -2
  end

  if otp == ARGV[1] then
    redis.call('DEL', KEYS[1])
    redis.call('DEL', KEYS[2])
    return 1
  end

  local newAttempts =
    redis.call('INCR', KEYS[2])

  if newAttempts == 1 then
    redis.call(
      'EXPIRE',
      KEYS[2],
      tonumber(ARGV[3])
    )
  end

  if newAttempts >= tonumber(ARGV[2]) then
    redis.call('DEL', KEYS[1])
    redis.call('DEL', KEYS[2])
    return -2
  end

  return 0
`;

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  private readonly ttl: number;
  private readonly length: number;
  private readonly maxAttempts: number;
  private readonly resendCooldown: number;
  private readonly otpPepper: string;

  constructor(
    private readonly configService: ConfigService,

    @Inject('REDIS_CLIENT')
    private readonly redisClient: Redis,

    private readonly emailService: EmailService,
  ) {
    this.ttl = Number(this.configService.get<number>('OTP_TTL_MIN', 10)) * 60;

    this.length = Number(this.configService.get<number>('OTP_LENGTH', 6));

    this.maxAttempts = Number(
      this.configService.get<number>('OTP_MAX_ATTEMPTS', 5),
    );

    this.resendCooldown = Number(
      this.configService.get<number>('OTP_RESEND_COOLDOWN_SEC', 60),
    );

    this.otpPepper = this.configService.getOrThrow<string>('OTP_PEPPER');

    if (this.length < 4 || this.length > 10) {
      throw new Error('OTP_LENGTH must be between 4 and 10');
    }

    if (this.maxAttempts < 1) {
      throw new Error('OTP_MAX_ATTEMPTS must be greater than 0');
    }

    if (this.ttl <= 0) {
      throw new Error('OTP_TTL_MIN must be greater than 0');
    }

    if (this.resendCooldown <= 0) {
      throw new Error('OTP_RESEND_COOLDOWN_SEC must be greater than 0');
    }
  }

  async createOtp(
    email: string,
    purpose: OtpPurpose = 'registration',
    options?: CreateOtpOptions,
  ): Promise<void> {
    const normalizedEmail = this.normalizeEmail(email);

    const otp = this.generateCode();
    const keys = this.getKeys(normalizedEmail, purpose);

    const hashedOtp = this.hashOtp(normalizedEmail, purpose, otp);

    /**
     * Redis NX gives us an atomic per-email/purpose resend cooldown.
     *
     * This remains useful even when the API has IP-based throttling because
     * an attacker can otherwise rotate through many source IPs.
     */
    const cooldownCreated = await this.redisClient.set(
      keys.cooldown,
      '1',
      'EX',
      this.resendCooldown,
      'NX',
    );

    if (cooldownCreated !== 'OK') {
      const ttl = await this.redisClient.ttl(keys.cooldown);
      const retryAfter = ttl > 0 ? ttl : this.resendCooldown;
      throw new BadRequestException({
        message: `Please wait ${retryAfter} second${retryAfter === 1 ? '' : 's'} before requesting another OTP.`,
        retryAfter,
      });
    }

    try {
      /**
       * MULTI ensures the new OTP replaces the old one and clears
       * the previous attempt counter as one atomic Redis operation.
       */
      await this.redisClient
        .multi()
        .set(keys.otp, hashedOtp, 'EX', this.ttl)
        .del(keys.attempts)
        .exec();

      const isDevelopment =
        this.configService.get<string>('NODE_ENV') !== 'production';

      if (isDevelopment) {
        this.logger.log(
          `🔑 [DEV OTP] ${purpose.toUpperCase()} code for ${normalizedEmail}: ${otp}`,
        );

        // In development, dispatch email asynchronously in background so developer gets instant ~50ms response
        void this.emailService
          .sendOtpEmail(normalizedEmail, otp, { ...options, purpose })
          .catch((error) => {
            this.logger.warn(
              `[DEV] Background email delivery failed (${(error as Error).message}), but OTP ${otp} remains active in Redis for local testing.`,
            );
          });

        return;
      }

      await this.emailService.sendOtpEmail(normalizedEmail, otp, {
        ...options,
        purpose,
      });
    } catch (error) {
      const isDevelopment =
        this.configService.get<string>('NODE_ENV') !== 'production';

      if (isDevelopment) {
        this.logger.warn(
          `[DEV] Email delivery failed (${(error as Error).message}), but OTP ${otp} remains active in Redis for local testing.`,
        );
        return;
      }

      /**
       * Never leave an OTP valid if delivery failed in production.
       */
      await this.redisClient
        .multi()
        .del(keys.otp)
        .del(keys.attempts)
        .del(keys.cooldown)
        .exec()
        .catch((cleanupError) => {
          this.logger.error('Failed to clean up OTP state', cleanupError);
        });

      throw error;
    }
  }

  async verifyOtp(
    email: string,
    code: string,
    purpose: OtpPurpose = 'registration',
  ): Promise<boolean> {
    const normalizedEmail = this.normalizeEmail(email);

    const normalizedCode = code.trim();

    /**
     * Reject malformed OTPs before touching Redis.
     */
    if (!new RegExp(`^\\d{${this.length}}$`).test(normalizedCode)) {
      throw new BadRequestException('Invalid OTP');
    }

    const keys = this.getKeys(normalizedEmail, purpose);

    /**
     * HMAC gives us a deterministic, peppered value to store instead of
     * the plaintext OTP.
     *
     * The pepper should be kept outside Redis and the database.
     */
    const hashedCode = this.hashOtp(normalizedEmail, purpose, normalizedCode);

    const result = await this.redisClient.eval(
      VERIFY_OTP_SCRIPT,
      2,
      keys.otp,
      keys.attempts,
      hashedCode,
      String(this.maxAttempts),
      String(this.ttl),
    );

    switch (Number(result)) {
      case 1:
        return true;

      case -1:
        throw new BadRequestException('OTP expired or not found');

      case -2:
        throw new BadRequestException(
          'Too many invalid attempts. Please request a new OTP.',
        );

      default:
        throw new BadRequestException('Invalid OTP');
    }
  }

  async verifyRegistrationOtp(email: string, code: string): Promise<boolean> {
    const normalizedEmail = this.normalizeEmail(email);
    await this.verifyOtp(normalizedEmail, code, 'registration');

    const keys = this.getKeys(normalizedEmail, 'registration');
    await this.redisClient.set(keys.verified, '1', 'EX', 900);
    return true;
  }

  async consumeVerification(
    email: string,
    purpose: OtpPurpose = 'registration',
  ): Promise<boolean> {
    const normalizedEmail = this.normalizeEmail(email);
    const keys = this.getKeys(normalizedEmail, purpose);
    const deleted = await this.redisClient.del(keys.verified);
    return deleted > 0;
  }

  async isOtpVerified(
    email: string,
    purpose: OtpPurpose = 'registration',
  ): Promise<boolean> {
    const normalizedEmail = this.normalizeEmail(email);
    const keys = this.getKeys(normalizedEmail, purpose);
    const val = await this.redisClient.get(keys.verified);
    return val === '1';
  }

  private generateCode(): string {
    const max = 10 ** this.length;

    return randomInt(0, max).toString().padStart(this.length, '0');
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private hashOtp(email: string, purpose: OtpPurpose, otp: string): string {
    return createHmac('sha256', this.otpPepper)
      .update(`${purpose}:${email}:${otp}`)
      .digest('hex');
  }

  private getKeys(email: string, purpose: OtpPurpose) {
    /**
     * Hash the email before putting it into a Redis key.
     *
     * This avoids exposing raw email addresses in Redis administration,
     * metrics, debugging output, or key scans.
     *
     * The Redis hash tag `{...}` is important for Redis Cluster:
     * all three keys must live in the same hash slot because the Lua script
     * accesses them together.
     */
    const emailHash = createHash('sha256').update(email).digest('hex');

    const namespace = `{${purpose}:${emailHash}}`;

    return {
      otp: `otp:v1:${namespace}:value`,
      attempts: `otp:v1:${namespace}:attempts`,
      cooldown: `otp:v1:${namespace}:cooldown`,
      verified: `otp:v1:${namespace}:verified`,
    };
  }
}
