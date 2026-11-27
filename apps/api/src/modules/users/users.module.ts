import { forwardRef, Module } from '@nestjs/common';
import { AuthCookiesModule } from '@api/modules/auth/auth-cookie.module';
import { AuthModule } from '@api/modules/auth/auth.module';
import { ReferralsModule } from '@api/modules/referrals/referrals.module';
import { UsersController } from './controllers/users.controller';
import { AdminUsersController } from './controllers/admin-user.controller';
import { UsersService } from './services/users.service';
import { UserAccountCleanupJob } from './jobs/user-account-cleanup.job';

@Module({
  imports: [
    AuthCookiesModule,
    forwardRef(() => AuthModule),
    forwardRef(() => ReferralsModule),
  ],
  controllers: [UsersController, AdminUsersController],
  providers: [UsersService, UserAccountCleanupJob],
  exports: [UsersService],
})
export class UsersModule {}
