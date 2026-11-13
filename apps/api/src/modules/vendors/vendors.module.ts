import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '@api/infrastructure/prisma/prisma.module';
import { SecurityModule } from '@api/modules/security/security.module';
import { AuthCookiesModule } from '@api/modules/auth/auth-cookies.module';
import { AuthModule } from '@api/modules/auth/auth.module';
import { OtpService } from '@api/modules/auth/otp/otp.service';
import { VendorAccountController } from './controllers/vendor-account.controller';
import { VendorAuthController } from './controllers/vendor-auth.controller';
import { PublicStoreController } from './controllers/public-store.controller';
import { AdminVendorsController } from './controllers/admin-vendors.controller';
import { VendorFollowsController } from './controllers/vendor-follows.controller';
import { VendorFollowsService } from './vendor-follows.service';
import { VendorsService } from './vendors.service';
import { VendorAuthService } from './vendor-auth.service';
import { AdminVendorsService } from './admin-vendors.service';
import { RegistrationsGuard } from '@api/common/guards/registrations.guard';

@Module({
  imports: [
    PrismaModule,
    SecurityModule,
    AuthCookiesModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [
    VendorAuthController,
    VendorAccountController,
    PublicStoreController,
    AdminVendorsController,
    VendorFollowsController,
  ],
  providers: [
    VendorsService,
    VendorFollowsService,
    VendorAuthService,
    AdminVendorsService,
    OtpService,
    RegistrationsGuard,
  ],
  exports: [
    VendorsService,
    VendorFollowsService,
    VendorAuthService,
    AdminVendorsService,
  ],
})
export class VendorsModule {}
