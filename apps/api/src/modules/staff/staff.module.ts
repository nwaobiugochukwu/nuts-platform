import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/infrastructure/database/prisma.module';
import { AuditModule } from '@api/modules/audit/audit.module';
import { AdminStaffController } from './controllers/admin-staff.controller';
import { StaffService } from './services/staff.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [AdminStaffController],
  providers: [StaffService],
  exports: [StaffService],
})
export class StaffModule {}
