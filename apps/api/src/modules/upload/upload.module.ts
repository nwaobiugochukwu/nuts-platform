import { Global, Module } from '@nestjs/common';
import { CloudinaryModule } from '@api/infrastructure/storage/cloudinary.module';
import { CloudinaryService } from '@api/infrastructure/storage/cloudinary.service';
import { LocalStorageStrategy } from './strategies/local-storage.strategy';
import { UploadController } from './controllers/image-upload.controller';
import { StorageStrategy } from './types/upload.types';

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
