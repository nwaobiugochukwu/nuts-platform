import { Module } from '@nestjs/common';
import { CacheWarmupService } from './cache-warmup.service';

@Module({
  providers: [CacheWarmupService],
})
export class CacheWarmupModule {}
