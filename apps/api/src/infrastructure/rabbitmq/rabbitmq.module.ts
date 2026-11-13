import { Global, Module } from '@nestjs/common';
import { AnalyticsConsumer } from './analytics.consumer';
import { EmailConsumer } from './email.consumer';
import { InventoryConsumer } from './inventory.consumer';
import { RabbitMQService } from './rabbitmq.service';

@Global()
@Module({
  providers: [
    RabbitMQService,
    EmailConsumer,
    AnalyticsConsumer,
    InventoryConsumer,
  ],
  exports: [RabbitMQService],
})
export class RabbitMQModule {}
