import { Global, Module } from '@nestjs/common';
import { ProcessedEventService } from './processed-event.service';

@Global()
@Module({
  providers: [ProcessedEventService],
  exports: [ProcessedEventService],
})
export class IdempotencyModule {}
