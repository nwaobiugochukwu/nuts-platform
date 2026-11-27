import { Module } from '@nestjs/common';
import { ReferralService } from './services/referral.service';

@Module({
  providers: [ReferralService],
  exports: [ReferralService],
})
export class ReferralsModule {}
