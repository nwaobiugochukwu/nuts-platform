import { Global, Module } from '@nestjs/common';
import { WorkflowClientService } from './workflow-client.service';
import { WorkflowStartConsumer } from './workflow-start.consumer';

@Global()
@Module({
  providers: [WorkflowClientService, WorkflowStartConsumer],
  exports: [WorkflowClientService],
})
export class WorkflowModule {}
