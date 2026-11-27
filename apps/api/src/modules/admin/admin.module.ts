import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/infrastructure/database/prisma.module';
import { CacheModule } from '@api/infrastructure/cache/cache.module';
import { AuditModule } from '@api/modules/audit/audit.module';
import { NotificationsModule } from '@api/modules/notifications/notifications.module';
import { AdminService } from './admin.service';
import { AdminAnnouncementsService } from './admin-announcements.service';
import { AdminAnnouncementsController } from './controllers/admin-announcements.controller';
import { AdminStaffController } from './controllers/admin-staff.controller';
import { AdminPlatformController } from './controllers/admin-platform.controller';

@Module({
  imports: [PrismaModule, CacheModule, AuditModule, NotificationsModule],
  controllers: [
    AdminAnnouncementsController,
    AdminStaffController,
    AdminPlatformController,
  ],
  providers: [AdminService, AdminAnnouncementsService],
  exports: [AdminService],
})
export class AdminModule {}
