import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/infrastructure/database/prisma.module';
import { AdminDiscountCodesController } from './controllers/admin-discount-codes.controller';
import { PublicDiscountCodesController } from './controllers/public-discount-codes.controller';
import { VendorDiscountCodesController } from './controllers/vendor-discount-codes.controller';
import { VoucherClaimsController } from './controllers/voucher-claims.controller';
import { DiscountCodeService } from './services/discount-code.service';
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
    VoucherClaimsService,
    VoucherClaimCleanupJob,
  ],
  exports: [DiscountCodeService, VoucherClaimsService],
})
export class DiscountsModule {}

export const DiscountCodeModule = DiscountsModule;
