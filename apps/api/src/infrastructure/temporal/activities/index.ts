import type { SampleActivities } from './sample.activities';

/**
 * The activity implementations a worker serves, keyed by the names workflows
 * call through `proxyActivities`. Add each new activity provider here.
 */
export function buildActivities(sample: SampleActivities) {
  return {
    echo: (message: string) => sample.echo(message),
  };
}
