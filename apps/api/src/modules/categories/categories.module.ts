import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/infrastructure/prisma/prisma.module';
import { RedisModule } from '@api/infrastructure/redis/redis.module';
import { CategoriesController } from './controllers/categories.controller';
import { AdminCategoryController } from './controllers/admin-category.controller';
import { CategoriesService } from './categories.service';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [CategoriesController, AdminCategoryController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
