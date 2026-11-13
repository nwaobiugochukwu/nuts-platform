import { isIP } from 'node:net';
import 'reflect-metadata';

import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Staging = 'staging',
  Test = 'test',
}

const ENV_ALIASES: Record<string, readonly string[]> = {
  JWT_SECRET: ['JWT_SECRET', 'JWT_ACCESS_SECRET'],
  JWT_REFRESH_SECRET: ['JWT_REFRESH_SECRET'],
  JWT_ISSUER: ['JWT_ISSUER', 'JWT_ACCESS_ISSUER', 'JWT_REFRESH_ISSUER'],
  JWT_ACCESS_AUDIENCE: [
    'JWT_ACCESS_AUDIENCE',
    'JWT_REFRESH_AUDIENCE',
    'JWT_AUDIENCE',
  ],
  JWT_REFRESH_AUDIENCE: ['JWT_REFRESH_AUDIENCE', 'JWT_ACCESS_AUDIENCE'],
  DATABASE_URL: ['DATABASE_URL', 'POSTGRESQL_URL'],
  COOKIE_DOMAIN: ['COOKIE_DOMAIN', 'AUTH_COOKIE_DOMAIN'],
  COOKIE_SAME_SITE: ['COOKIE_SAME_SITE', 'AUTH_COOKIE_SAME_SITE'],
};

function resolveEnvAlias(
  config: Record<string, unknown>,
  key: string,
): unknown {
  const aliases = ENV_ALIASES[key] ?? [key];
  for (const alias of aliases) {
    const value = config[alias] ?? process.env[alias];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return undefined;
}

function normalizeEnvironmentConfig(config: Record<string, unknown>) {
  const normalized = { ...config };

  for (const key of Object.keys(ENV_ALIASES)) {
    const value = resolveEnvAlias(normalized, key);
    if (value !== undefined) {
      normalized[key] = value;
      if (typeof value === 'string') {
        process.env[key] = value;
      }
    }
  }

  if (
    !normalized['DATABASE_URL'] &&
    typeof normalized['POSTGRESQL_URL'] === 'string'
  ) {
    normalized['DATABASE_URL'] = normalized['POSTGRESQL_URL'];
    process.env['DATABASE_URL'] = normalized['POSTGRESQL_URL'];
  }

  if (
    !normalized['COOKIE_DOMAIN'] &&
    typeof normalized['AUTH_COOKIE_DOMAIN'] === 'string'
  ) {
    normalized['COOKIE_DOMAIN'] = normalized['AUTH_COOKIE_DOMAIN'];
    process.env['COOKIE_DOMAIN'] = normalized['AUTH_COOKIE_DOMAIN'];
  }

  if (
    !normalized['COOKIE_SAME_SITE'] &&
    typeof normalized['AUTH_COOKIE_SAME_SITE'] === 'string'
  ) {
    normalized['COOKIE_SAME_SITE'] = normalized['AUTH_COOKIE_SAME_SITE'];
    process.env['COOKIE_SAME_SITE'] = normalized['AUTH_COOKIE_SAME_SITE'];
  }

  return normalized;
}

export class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  PORT: number = 3001;

  // ─── JWT ────────────────────────────────────────────────────────────────────

  @IsDefined()
  @IsString()
  @MinLength(32)
  JWT_SECRET!: string;

  @IsDefined()
  @IsString()
  @MinLength(32)
  JWT_REFRESH_SECRET!: string;

  @IsString()
  @IsOptional()
  JWT_ACCESS_EXPIRES_IN = '15m';

  @IsString()
  @IsOptional()
  JWT_REFRESH_EXPIRES_IN = '7d';

  @IsDefined()
  @IsString()
  JWT_ISSUER!: string;

  @IsDefined()
  @IsString()
  JWT_ACCESS_AUDIENCE!: string;

  // ─── Database ────────────────────────────────────────────────────────────────

  @IsDefined()
  @IsString()
  DATABASE_URL!: string;

  @IsString()
  @IsOptional()
  DIRECT_URL?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(100)
  @IsOptional()
  PRISMA_SLOW_QUERY_MS: number = 1000;

  // ─── Redis / BullMQ ──────────────────────────────────────────────────────────

  @IsString()
  @IsOptional()
  REDIS_URL = 'redis://localhost:6379';

  @IsString()
  @IsOptional()
  BULLMQ_PREFIX = '{nuts}';

  @IsString()
  @IsOptional()
  RABBITMQ_ENABLED = 'true';

  @IsString()
  @IsOptional()
  RABBITMQ_URL?: string;

  // ─── HTTP / CORS ─────────────────────────────────────────────────────────────

  @IsString()
  @IsOptional()
  BASE_URL: string = 'http://localhost:3001';

  @IsString()
  @IsOptional()
  ALLOWED_ORIGINS?: string;

  @IsString()
  @IsOptional()
  COOKIE_DOMAIN?: string;

  @IsString()
  @IsOptional()
  COOKIE_SAME_SITE: string = 'lax';

  // ─── Payments ────────────────────────────────────────────────────────────────

  @IsString()
  @IsOptional()
  PAYSTACK_SECRET_KEY?: string;

  @IsString()
  @IsOptional()
  PAYSTACK_CALLBACK_URL?: string;

  @IsString()
  @IsOptional()
  DEFAULT_CURRENCY = 'ngn';

  // ─── Email delivery ──────────────────────────────────────────────────────────

  @IsString()
  @IsOptional()
  EMAIL_FROM?: string;

  @IsString()
  @IsOptional()
  BREVO_API_KEY?: string;

  // ─── OTP ─────────────────────────────────────────────────────────────────────

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  OTP_TTL_MIN: number = 10;

  @Type(() => Number)
  @IsNumber()
  @Min(4)
  @IsOptional()
  OTP_LENGTH: number = 6;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  OTP_MAX_ATTEMPTS: number = 5;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  OTP_RESEND_COOLDOWN_SEC: number = 60;

  // ─── Users / Accounts ────────────────────────────────────────────────────────

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  ACCOUNT_DELETION_GRACE_DAYS?: number;

  // ─── Referrals ───────────────────────────────────────────────────────────────

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  REFERRAL_DISCOUNT_AMOUNT: number = 500;

  // ─── Admin ───────────────────────────────────────────────────────────────────

  @IsString()
  @IsOptional()
  @MinLength(32)
  ADMIN_SETUP_SECRET?: string;

  // ─── Checkout ────────────────────────────────────────────────────────────────

  @IsString()
  @IsOptional()
  CHECKOUT_REVALIDATE_PRICES: string = 'true';

  @IsDefined()
  @IsString()
  @MinLength(32)
  OTP_PEPPER!: string;

  // ─── Dev / Tooling ───────────────────────────────────────────────────────────

  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;

    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;

    return value;
  })
  @IsBoolean()
  @IsOptional()
  SWAGGER_ENABLED = false;

  // ─── Google OAuth ────────────────────────────────────────────────────────────

  @IsString()
  @IsOptional()
  GOOGLE_CLIENT_ID?: string;

  @IsString()
  @IsOptional()
  GOOGLE_CLIENT_SECRET?: string;

  // ─── Observability / Sentry ──────────────────────────────────────────────────

  @IsString()
  @IsOptional()
  SENTRY_DSN?: string;

  @IsString()
  @IsOptional()
  SENTRY_ENVIRONMENT?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  SENTRY_TRACES_SAMPLE_RATE?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  SENTRY_PROFILES_SAMPLE_RATE?: number;

  @IsString()
  @IsOptional()
  SENTRY_RELEASE?: string;
}

const PROD_REQUIRED: Array<keyof EnvironmentVariables> = [
  'PAYSTACK_SECRET_KEY',
  'PAYSTACK_CALLBACK_URL',
  'ADMIN_SETUP_SECRET',
  'EMAIL_FROM',
  'BREVO_API_KEY',
  'ALLOWED_ORIGINS',
  'REDIS_URL',
  'RABBITMQ_URL',
  'JWT_ISSUER',
  'JWT_ACCESS_AUDIENCE',
  'OTP_PEPPER',
];

const PROD_SECRET_KEYS: Array<keyof EnvironmentVariables> = [
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'ADMIN_SETUP_SECRET',
  'OTP_PEPPER',
  'PAYSTACK_SECRET_KEY',
  'BREVO_API_KEY',
];

const PLACEHOLDER_SECRET_PATTERN =
  /^(?:change[-_ ]?me|replace[-_ ]?(?:me|with)|your[-_ ]|example(?:[-_ ]|$)|placeholder(?:[-_ ]|$)|<)/i;

function durationInMs(value: string): number | null {
  const match = /^(\d+)(s|m|h|d)$/.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  const unitMs: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return amount > 0 ? amount * unitMs[match[2]] : null;
}

function isProductionHttpsUrl(value: string, requireOrigin = false): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const isLocal =
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host === '127.0.0.1' ||
      host === '::1' ||
      isIP(host) !== 0;
    return (
      url.protocol === 'https:' &&
      !isLocal &&
      !url.username &&
      !url.password &&
      (!requireOrigin || url.origin === value.trim().replace(/\/+$/, ''))
    );
  } catch {
    return false;
  }
}

export function validateEnv(config: Record<string, unknown>) {
  const normalizedConfig = normalizeEnvironmentConfig(config);

  // Numeric settings use explicit @Type decorators. Avoid Boolean("false")
  // converting a disabled feature flag into true.
  const validated = plainToInstance(EnvironmentVariables, normalizedConfig);

  const errors = validateSync(validated, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(
      `Environment validation failed:\n${errors
        .map((e) => {
          const constraints = Object.values(e.constraints ?? {}).join(', ');
          return `  ${e.property}: ${constraints}`;
        })
        .join('\n')}`,
    );
  }

  if (validated.NODE_ENV === Environment.Production) {
    const missing = PROD_REQUIRED.filter((key) => !validated[key]);

    if (missing.length > 0) {
      throw new Error(
        `Missing required production environment variables:\n${missing
          .map((key) => `  - ${key}`)
          .join('\n')}`,
      );
    }

    if (validated.RABBITMQ_ENABLED === 'false') {
      throw new Error(
        'RABBITMQ_ENABLED must be true in production because transactional outbox events require the broker relay.',
      );
    }

    const allowedOrigins = (validated.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);

    if (
      allowedOrigins.length === 0 ||
      allowedOrigins.some((origin) => !isProductionHttpsUrl(origin, true))
    ) {
      throw new Error(
        'ALLOWED_ORIGINS must contain only exact HTTPS storefront origins (no localhost, paths, or tunnel hosts) in production.',
      );
    }

    const isLivePaystack =
      validated.PAYSTACK_SECRET_KEY?.startsWith('sk_live_');

    if (validated.PAYSTACK_CALLBACK_URL) {
      try {
        new URL(validated.PAYSTACK_CALLBACK_URL);
      } catch {
        throw new Error('PAYSTACK_CALLBACK_URL must be a valid URL.');
      }

      if (
        isLivePaystack &&
        !isProductionHttpsUrl(validated.PAYSTACK_CALLBACK_URL)
      ) {
        throw new Error(
          'PAYSTACK_CALLBACK_URL must be a public HTTPS URL in production.',
        );
      }
    }

    const databaseSslMode = (() => {
      try {
        return new URL(validated.DATABASE_URL).searchParams
          .get('sslmode')
          ?.toLowerCase();
      } catch {
        return undefined;
      }
    })();
    if (
      !['require', 'verify-ca', 'verify-full'].includes(databaseSslMode ?? '')
    ) {
      throw new Error(
        'DATABASE_URL must require TLS with sslmode=require, verify-ca, or verify-full in production.',
      );
    }

    if (validated.DIRECT_URL) {
      try {
        const directSslMode = new URL(validated.DIRECT_URL).searchParams
          .get('sslmode')
          ?.toLowerCase();
        if (
          !['require', 'verify-ca', 'verify-full'].includes(directSslMode ?? '')
        ) {
          throw new Error();
        }
      } catch {
        throw new Error(
          'DIRECT_URL must require TLS with sslmode=require, verify-ca, or verify-full in production.',
        );
      }
    }

    if (
      !validated.PAYSTACK_SECRET_KEY?.startsWith('sk_live_') &&
      !validated.PAYSTACK_SECRET_KEY?.startsWith('sk_test_')
    ) {
      throw new Error(
        'PAYSTACK_SECRET_KEY must start with sk_test_ or sk_live_.',
      );
    }

    try {
      const redisUrl = new URL(validated.REDIS_URL);
      if (redisUrl.protocol !== 'rediss:' || !redisUrl.password) {
        throw new Error();
      }
    } catch {
      throw new Error(
        'REDIS_URL must use rediss:// and include a password in production.',
      );
    }

    if (validated.RABBITMQ_ENABLED !== 'false') {
      try {
        const rabbitUrl = new URL(validated.RABBITMQ_URL ?? '');
        if (
          rabbitUrl.protocol !== 'amqps:' ||
          !rabbitUrl.username ||
          !rabbitUrl.password ||
          rabbitUrl.username === 'guest'
        ) {
          throw new Error();
        }
      } catch {
        throw new Error(
          'RABBITMQ_URL must use amqps:// with a non-guest account when RabbitMQ is enabled in production.',
        );
      }
    }

    const accessTokenMs = durationInMs(validated.JWT_ACCESS_EXPIRES_IN);
    const refreshTokenMs = durationInMs(validated.JWT_REFRESH_EXPIRES_IN);
    if (accessTokenMs === null || accessTokenMs > 15 * 60_000) {
      throw new Error(
        'JWT_ACCESS_EXPIRES_IN must be a valid duration no longer than 15m in production.',
      );
    }
    if (
      refreshTokenMs === null ||
      refreshTokenMs <= accessTokenMs ||
      refreshTokenMs > 30 * 86_400_000
    ) {
      throw new Error(
        'JWT_REFRESH_EXPIRES_IN must be longer than access expiry and no longer than 30d in production.',
      );
    }

    const placeholderSecrets = PROD_SECRET_KEYS.filter((key) => {
      const value = validated[key];
      return (
        typeof value === 'string' &&
        PLACEHOLDER_SECRET_PATTERN.test(value.trim())
      );
    });

    if (placeholderSecrets.length > 0) {
      throw new Error(
        `Replace placeholder production secrets before startup:\n${placeholderSecrets
          .map((key) => `  - ${key}`)
          .join('\n')}`,
      );
    }
  }

  return validated;
}
