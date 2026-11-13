import { Throttle } from '@nestjs/throttler';

export const StrictThrottle = () =>
  Throttle({
    default: {
      ttl: 60_000, // 1 minute
      limit: 5, // 5 attempts per minute
    },
  });

export const ModerateThrottle = () =>
  Throttle({
    default: {
      ttl: 60_000, // 1 minute
      limit: 20, // 20 attempts per minute
    },
  });

export const RelaxedThrottle = () =>
  Throttle({
    default: {
      ttl: 60_000, // 1 minute
      limit: 100, // 100 attempts per minute
    },
  });

// Specialized throttling for sensitive operations
export const RefreshTokenThrottle = () =>
  Throttle({
    default: {
      ttl: 60_000, // 1 minute
      limit: 10, // 10 refresh attempts per minute (prevent token rotation attacks)
    },
  });

export const OtpThrottle = () =>
  Throttle({
    default: {
      ttl: 300_000, // 5 minutes
      limit: 3, // 3 OTP requests per 5 minutes (prevent OTP enumeration)
    },
  });

export const PasswordResetThrottle = () =>
  Throttle({
    default: {
      ttl: 3600_000, // 1 hour
      limit: 5, // 5 password reset attempts per hour
    },
  });
