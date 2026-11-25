import { Global, Module } from '@nestjs/common';
import { HeartbeatService } from './heartbeat.service';

@Global()
@Module({
  providers: [HeartbeatService],
  exports: [HeartbeatService],
})
export class HeartbeatModule {}
