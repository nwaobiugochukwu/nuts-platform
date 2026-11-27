import { Global, Module } from '@nestjs/common';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';
import { OutboxRelay } from './outbox.relay';
import { OutboxService } from './outbox.service';

@Global()
@Module({
  imports: [RabbitMQModule],
  providers: [OutboxService, OutboxRelay],
  exports: [OutboxService, OutboxRelay],
})
export class OutboxModule {}
