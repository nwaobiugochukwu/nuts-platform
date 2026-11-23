import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/infrastructure/prisma/prisma.module';
import { AdminDiscountCodesController } from './controllers/admin-discount-codes.controller';
import { PublicDiscountCodesController } from './controllers/public-discount-codes.controller';
import { VendorDiscountCodesController } from './controllers/vendor-discount-codes.controller';
import { VoucherClaimsController } from './controllers/voucher-claims.controller';
import { DiscountCodeService } from './discount-code.service';
import { VoucherClaimCleanupCron } from './jobs/voucher-claim-cleanup.cron';
import { VoucherClaimsService } from './voucher-claims.service';

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
    VoucherClaimCleanupCron,
  ],
  exports: [DiscountCodeService, VoucherClaimsService],
})
export class DiscountsModule {}

export const DiscountCodeModule = DiscountsModule;
