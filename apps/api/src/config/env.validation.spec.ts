import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  it('accepts legacy env aliases used by the project configuration', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        PORT: '3001',
        JWT_ACCESS_SECRET: '12345678901234567890123456789012',
        JWT_REFRESH_SECRET: '12345678901234567890123456789012',
        JWT_ACCESS_ISSUER: 'nuts',
        JWT_ACCESS_AUDIENCE: 'nuts-api',
        JWT_REFRESH_AUDIENCE: 'nuts-api',
        DATABASE_URL:
          'postgresql://user:pass@localhost:5432/nuts?schema=public',
        REDIS_URL: 'redis://localhost:6379',
        BASE_URL: 'http://localhost:3001',
        ALLOWED_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        COOKIE_DOMAIN: 'localhost',
        PAYSTACK_SECRET_KEY: 'sk_test_example',
        PAYSTACK_CALLBACK_URL: 'https://example.com/order-success',
        ADMIN_SETUP_SECRET: '12345678901234567890123456789012',
        EMAIL_FROM: 'test@example.com',
        BREVO_API_KEY: 'brevo-api-key',
        OTP_PEPPER: '12345678901234567890123456789012',
      }),
    ).not.toThrow();
  });

  it('rejects localhost storefront origins and temporary callback URLs in production', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'access-secret-which-is-at-least-32-characters',
        JWT_REFRESH_SECRET: 'refresh-secret-which-is-at-least-32-characters',
        JWT_ISSUER: 'nuts',
        JWT_ACCESS_AUDIENCE: 'nuts-api',
        JWT_REFRESH_AUDIENCE: 'nuts-api',
        JWT_ACCESS_EXPIRES_IN: '15m',
        JWT_REFRESH_EXPIRES_IN: '7d',
        DATABASE_URL:
          'postgresql://app:db-pass@db.example:5432/nuts?sslmode=require',
        REDIS_URL: 'rediss://app:redis-pass@redis.example:6379',
        RABBITMQ_URL: 'amqps://app:rabbit-pass@rabbit.example:5671',
        BASE_URL: 'http://localhost:3001',
        ALLOWED_ORIGINS: 'http://localhost:3000',
        PAYSTACK_SECRET_KEY: 'sk_live_valid-shaped-secret',
        PAYSTACK_CALLBACK_URL: 'https://temporary.ngrok-free.dev/order-success',
        ADMIN_SETUP_SECRET: 'admin-bootstrap-secret-at-least-32-chars',
        OTP_PEPPER: 'otp-pepper-secret-which-is-at-least-32-characters',
        EMAIL_FROM: 'support@nuts.example',
        BREVO_API_KEY: 'brevo-api-key',
      }),
    ).toThrow(
      /ALLOWED_ORIGINS must contain only exact HTTPS storefront origins/,
    );
  });

  it('accepts TLS-backed infrastructure and exact HTTPS origins in production', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'access-secret-which-is-at-least-32-characters',
        JWT_REFRESH_SECRET: 'refresh-secret-which-is-at-least-32-characters',
        JWT_ISSUER: 'nuts',
        JWT_ACCESS_AUDIENCE: 'nuts-api',
        JWT_REFRESH_AUDIENCE: 'nuts-api',
        JWT_ACCESS_EXPIRES_IN: '15m',
        JWT_REFRESH_EXPIRES_IN: '7d',
        DATABASE_URL:
          'postgresql://app:db-pass@db.example:5432/nuts?sslmode=verify-full',
        REDIS_URL: 'rediss://app:redis-pass@redis.example:6379',
        RABBITMQ_URL: 'amqps://app:rabbit-pass@rabbit.example:5671',
        BASE_URL: 'https://api.example.com',
        ALLOWED_ORIGINS: 'https://shop.example.com,https://www.example.com',
        PAYSTACK_SECRET_KEY: 'sk_live_valid-shaped-secret',
        PAYSTACK_CALLBACK_URL: 'https://shop.example.com/order-success',
        ADMIN_SETUP_SECRET: 'admin-bootstrap-secret-at-least-32-chars',
        OTP_PEPPER: 'otp-pepper-secret-which-is-at-least-32-characters',
        EMAIL_FROM: 'support@nuts.example',
        BREVO_API_KEY: 'brevo-api-key',
      }),
    ).not.toThrow();
  });

  it('accepts sk_test_ Paystack keys in production for test and learning environments', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'access-secret-which-is-at-least-32-characters',
        JWT_REFRESH_SECRET: 'refresh-secret-which-is-at-least-32-characters',
        JWT_ISSUER: 'nuts',
        JWT_ACCESS_AUDIENCE: 'nuts-api',
        JWT_REFRESH_AUDIENCE: 'nuts-api',
        JWT_ACCESS_EXPIRES_IN: '15m',
        JWT_REFRESH_EXPIRES_IN: '7d',
        DATABASE_URL:
          'postgresql://app:db-pass@db.example:5432/nuts?sslmode=verify-full',
        REDIS_URL: 'rediss://app:redis-pass@redis.example:6379',
        RABBITMQ_URL: 'amqps://app:rabbit-pass@rabbit.example:5671',
        ALLOWED_ORIGINS: 'https://shop.example.com',
        PAYSTACK_SECRET_KEY: 'sk_test_valid-test-secret',
        PAYSTACK_CALLBACK_URL: 'https://shop.example.com/order-success',
        ADMIN_SETUP_SECRET: 'admin-bootstrap-secret-at-least-32-chars',
        OTP_PEPPER: 'otp-pepper-secret-which-is-at-least-32-characters',
        EMAIL_FROM: 'support@nuts.example',
        BREVO_API_KEY: 'brevo-api-key',
      }),
    ).not.toThrow();
  });
});
