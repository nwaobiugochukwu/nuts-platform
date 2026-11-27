import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/infrastructure/database/prisma.module';
import { CacheModule } from '@api/infrastructure/cache/cache.module';
import { AuditModule } from '@api/modules/audit/audit.module';
import { NotificationsModule } from '@api/modules/notifications/notifications.module';
import { AdminAnnouncementsController } from './controllers/admin-announcements.controller';
import { AdminAnnouncementsService } from './services/admin-announcements.service';

@Module({
  imports: [PrismaModule, CacheModule, AuditModule, NotificationsModule],
  controllers: [AdminAnnouncementsController],
  providers: [AdminAnnouncementsService],
})
export class AnnouncementsModule {}
