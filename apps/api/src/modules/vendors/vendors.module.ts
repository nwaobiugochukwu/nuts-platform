import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '@api/infrastructure/database/prisma.module';
import { SecurityModule } from '@api/modules/security/security.module';
import { AuthCookiesModule } from '@api/modules/auth/auth-cookies.module';
import { AuthModule } from '@api/modules/auth/auth.module';
import { OtpService } from '@api/modules/auth/services/otp.service';
import { VendorAccountController } from './controllers/vendor-account.controller';
import { PublicStoreController } from './controllers/public-store.controller';
import { AdminVendorsController } from './controllers/admin-vendors.controller';
import { VendorFollowsController } from './controllers/vendor-follows.controller';
import { VendorFollowsService } from './services/vendor-follows.service';
import { VendorsService } from './services/vendors.service';
import { AdminVendorsService } from './services/admin-vendors.service';
import { RegistrationsGuard } from '@api/common/guards/registrations.guard';

@Module({
  imports: [
    PrismaModule,
    SecurityModule,
    AuthCookiesModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [
    VendorAccountController,
    VendorFollowsController,
    AdminVendorsController,
    PublicStoreController,
  ],
  providers: [
    VendorsService,
    VendorFollowsService,
    AdminVendorsService,
    OtpService,
    RegistrationsGuard,
  ],
  exports: [VendorsService, VendorFollowsService, AdminVendorsService],
})
export class VendorsModule {}
