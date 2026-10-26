import { Module } from '@nestjs/common';
import { MailModule } from '@api/modules/infrastructure/mail/mail.module';
import { PrismaModule } from '@api/modules/infrastructure/prisma/prisma.module';
import { AdminVendorsController } from './admin-vendors.controller';
import { AdminVendorsService } from './admin-vendors.service';

@Module({
  imports: [PrismaModule, MailModule],
  controllers: [AdminVendorsController],
  providers: [AdminVendorsService],
})
export class AdminVendorsModule {}
