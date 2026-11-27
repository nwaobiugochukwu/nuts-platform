import { Global, Module } from '@nestjs/common';
import { TransactionRunnerService } from './transaction-runner.service';

@Global()
@Module({
  providers: [TransactionRunnerService],
  exports: [TransactionRunnerService],
})
export class TransactionModule {}
