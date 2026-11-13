import { Global, Module } from '@nestjs/common';
import { CloudinaryModule } from '@api/infrastructure/cloudinary/cloudinary.module';
import { CloudinaryService } from '@api/infrastructure/cloudinary/cloudinary.service';
import { LocalStorageStrategy } from './strategies/local-storage.strategy';
import { UploadController } from './controllers/upload.controller';
import { StorageStrategy } from './upload.interface';

@Global()
@Module({
  imports: [CloudinaryModule],
  controllers: [UploadController],
  providers: [
    {
      provide: StorageStrategy,
      useClass: LocalStorageStrategy,
    },
    CloudinaryService,
  ],
  exports: [StorageStrategy, CloudinaryService],
})
export class UploadModule {}
