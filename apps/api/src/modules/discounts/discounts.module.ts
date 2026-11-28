import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/infrastructure/database/prisma.module';
import { AdminDiscountCodesController } from './controllers/admin-discount-codes.controller';
import { PublicDiscountCodesController } from './controllers/public-discount-codes.controller';
import { VendorDiscountCodesController } from './controllers/vendor-discount-codes.controller';
import { VoucherClaimsController } from './controllers/voucher-claims.controller';
import { DiscountCodeManagementService } from './services/discount-code-management.service';
import { DiscountCodeService } from './services/discount-code.service';
import { FirstOrderEligibilityService } from './services/first-order-eligibility.service';
import { PublicPromotionsService } from './services/public-promotions.service';
import { VoucherClaimCleanupJob } from './jobs/voucher-claim-cleanup.job';
import { VoucherClaimsService } from './services/voucher-claims.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    AdminDiscountCodesController,
    VendorDiscountCodesController,
    PublicDiscountCodesController,
    VoucherClaimsController,
  ],
  providers: [
    DiscountCodeService,
    DiscountCodeManagementService,
    PublicPromotionsService,
    FirstOrderEligibilityService,
    VoucherClaimsService,
    VoucherClaimCleanupJob,
  ],
  exports: [
    DiscountCodeService,
    PublicPromotionsService,
    FirstOrderEligibilityService,
    VoucherClaimsService,
  ],
})
export class DiscountsModule {}

export const DiscountCodeModule = DiscountsModule;
