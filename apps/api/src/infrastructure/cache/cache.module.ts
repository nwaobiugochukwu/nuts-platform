import { Global, Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { RedlockService } from '../redis/redlock.service';
import { CacheService } from './cache.service';
import { AdminCacheController } from './controllers/admin-cache.controller';

@Global()
@Module({
  imports: [RedisModule],
  controllers: [AdminCacheController],
  providers: [CacheService, RedlockService],
  exports: [CacheService],
})
export class CacheModule {}
