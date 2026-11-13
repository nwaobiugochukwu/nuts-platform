import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/infrastructure/prisma/prisma.module';
import { CacheModule } from '@api/infrastructure/cache/cache.module';
import { AuditLogModule } from '@api/common/audit-log/audit-log.module';
import { NotificationsModule } from '@api/modules/notifications/notifications.module';
import { AdminService } from './admin.service';
import { AdminAnnouncementsService } from './admin-announcements.service';
import { AdminAnnouncementsController } from './controllers/admin-announcements.controller';
import { AdminStaffController } from './controllers/admin-staff.controller';
import { AdminPlatformController } from './controllers/admin-platform.controller';

@Module({
  imports: [PrismaModule, CacheModule, AuditLogModule, NotificationsModule],
  controllers: [
    AdminAnnouncementsController,
    AdminStaffController,
    AdminPlatformController,
  ],
  providers: [AdminService, AdminAnnouncementsService],
  exports: [AdminService],
})
export class AdminModule {}
