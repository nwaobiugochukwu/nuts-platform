import { SetMetadata } from '@nestjs/common';
import type { OtpPurpose } from '@api/modules/auth/otp/otp.service';

export const OTP_REQUIRED_KEY = 'otpRequired';

export const OtpRequired = (purpose: OtpPurpose = 'registration') =>
  SetMetadata(OTP_REQUIRED_KEY, purpose);
