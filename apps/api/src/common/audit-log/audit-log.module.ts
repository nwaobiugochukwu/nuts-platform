import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from '@api/infrastructure/prisma/prisma.module';
import { AuditConsumer } from './audit.consumer';
import { AuditInterceptor } from './audit.interceptor';
import { AuditLogService } from './audit-log.service';
import { AuditWriter } from './audit-writer';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    AuditWriter,
    AuditLogService,
    AuditConsumer,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuditLogService, AuditWriter],
})
export class AuditLogModule {}
