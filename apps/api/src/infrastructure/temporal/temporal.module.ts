import { Global, Module } from '@nestjs/common';
import { TemporalClientService } from './temporal-client.service';
import { WorkflowStartConsumer } from './workflow-start.consumer';

@Global()
@Module({
  providers: [TemporalClientService, WorkflowStartConsumer],
  exports: [TemporalClientService],
})
export class TemporalModule {}
