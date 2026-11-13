import { forwardRef, Module } from '@nestjs/common';
import { AuthCookiesModule } from '@api/modules/auth/auth-cookies.module';
import { AuthModule } from '@api/modules/auth/auth.module';
import { ReferralsModule } from '@api/modules/referrals/referral.module';
import { UsersController } from './controllers/users.controller';
import { AdminUsersController } from './controllers/admin-user.controller';
import { UsersService } from './users.service';
import { UserAccountCleanupService } from './jobs/user-account-cleanup.cron';

@Module({
  imports: [
    AuthCookiesModule,
    forwardRef(() => AuthModule),
    forwardRef(() => ReferralsModule),
  ],
  controllers: [UsersController, AdminUsersController],
  providers: [UsersService, UserAccountCleanupService],
  exports: [UsersService],
})
export class UsersModule {}
