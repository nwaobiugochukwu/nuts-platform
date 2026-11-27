import { Injectable } from '@nestjs/common';

/**
 * Activities do the real work: database writes, HTTP calls, messages. They must
 * be idempotent because Temporal retries them. Register providers like this in
 * TemporalWorkerModule and add their methods to the worker's activity map.
 */
@Injectable()
export class SampleActivities {
  echo(message: string): Promise<string> {
    return Promise.resolve(`echo: ${message}`);
  }
}
