import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/infrastructure/prisma/prisma.module';
import { UserWalletController } from './controllers/user-wallet.controller';
import { VendorWalletController } from './controllers/vendor-wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [PrismaModule],
  controllers: [UserWalletController, VendorWalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletsModule {}

export const WalletModule = WalletsModule;
