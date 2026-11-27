import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from '@api/infrastructure/database/prisma.module';
import { AuditConsumer } from './consumers/audit.consumer';
import { AuditInterceptor } from './interceptors/audit.interceptor';
import { AuditLogService } from './services/audit-log.service';
import { AuditWriterService } from './services/audit-writer.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    AuditWriterService,
    AuditLogService,
    AuditConsumer,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuditLogService, AuditWriterService],
})
export class AuditModule {}
