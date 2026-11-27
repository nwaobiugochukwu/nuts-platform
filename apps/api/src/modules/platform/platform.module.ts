import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/infrastructure/database/prisma.module';
import { CacheModule } from '@api/infrastructure/cache/cache.module';
import { AuditModule } from '@api/modules/audit/audit.module';
import { AdminPlatformController } from './controllers/admin-platform.controller';
import { PlatformService } from './services/platform.service';

@Module({
  imports: [PrismaModule, CacheModule, AuditModule],
  controllers: [AdminPlatformController],
  providers: [PlatformService],
  exports: [PlatformService],
})
export class PlatformModule {}
