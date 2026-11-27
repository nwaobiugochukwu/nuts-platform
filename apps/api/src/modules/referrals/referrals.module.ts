import { Module } from '@nestjs/common';
import { ReferralRewardConsumer } from './consumers/referral-reward.consumer';
import { ReferralService } from './services/referral.service';

@Module({
  providers: [ReferralService, ReferralRewardConsumer],
  exports: [ReferralService],
})
export class ReferralsModule {}
