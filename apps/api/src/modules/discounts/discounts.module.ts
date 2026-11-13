import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/infrastructure/prisma/prisma.module';
import { AdminDiscountCodesController } from './controllers/admin-discount-codes.controller';
import { VendorDiscountCodesController } from './controllers/vendor-discount-codes.controller';
import { DiscountCodeService } from './discount-code.service';

@Module({
  imports: [PrismaModule],
  controllers: [AdminDiscountCodesController, VendorDiscountCodesController],
  providers: [DiscountCodeService],
  exports: [DiscountCodeService],
})
export class DiscountsModule {}

export const DiscountCodeModule = DiscountsModule;
