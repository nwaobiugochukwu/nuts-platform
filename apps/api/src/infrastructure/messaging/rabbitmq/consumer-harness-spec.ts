// Test helper (the name ends in "spec.ts" so the build excludes it; it has no ".spec." so Jest
// does not run it). It stands in for RabbitMQService: a consumer registers its handler, and the
// test calls that handler directly with a payload, exactly as the broker would.
import type { RabbitMQService } from './rabbitmq.service';

export type Handler = (payload: unknown, message?: unknown) => Promise<void>;

export function fakeRabbit() {
  const consumers: Array<{ queue: string; handler: Handler }> = [];
  const consume = jest.fn((queue: string, handler: Handler) => {
    consumers.push({ queue, handler });
    return Promise.resolve();
  });
  return {
    rabbit: { consume } as unknown as RabbitMQService,
    consume,
    consumers,
    /** The handler registered for a queue; throws if the consumer did not register. */
    handlerFor(queue: string): Handler {
      const found = consumers.find((entry) => entry.queue === queue);
      if (!found) throw new Error(`No consumer registered for ${queue}`);
      return found.handler;
    },
  };
}

/** Runs `fn` with PROCESS_ROLE set (or unset), then restores the previous value. */
export async function withRole<T>(
  role: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = process.env.PROCESS_ROLE;
  if (role === undefined) delete process.env.PROCESS_ROLE;
  else process.env.PROCESS_ROLE = role;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.PROCESS_ROLE;
    else process.env.PROCESS_ROLE = previous;
  }
}
