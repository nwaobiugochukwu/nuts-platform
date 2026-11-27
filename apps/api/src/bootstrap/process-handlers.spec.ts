import { EventEmitter } from 'node:events';
import { installProcessErrorHandlers } from './process-handlers';

function setup(
  report: (e: Error, t: Record<string, string>) => Promise<unknown>,
) {
  const target = new EventEmitter();
  const exit = jest.fn();
  installProcessErrorHandlers({
    program: 'worker',
    target,
    exit,
    report,
    graceMs: 50,
  });
  return { target, exit };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('installProcessErrorHandlers', () => {
  it('reports an uncaught exception once and exits with code 1', async () => {
    const report = jest.fn(() => Promise.resolve());
    const { target, exit } = setup(report);

    target.emit('uncaughtException', new Error('boom'));
    target.emit('uncaughtException', new Error('second'));
    await settle();

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'boom' }),
      {
        program: 'worker',
        kind: 'uncaughtException',
      },
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('treats an unhandled rejection with a non-error reason as fatal too', async () => {
    const report = jest.fn(() => Promise.resolve());
    const { target, exit } = setup(report);

    target.emit('unhandledRejection', 'plain string');
    await settle();

    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'plain string' }),
      { program: 'worker', kind: 'unhandledRejection' },
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('still exits when reporting itself fails', async () => {
    const { target, exit } = setup(() =>
      Promise.reject(new Error('sentry down')),
    );

    target.emit('uncaughtException', new Error('boom'));
    await settle();

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits after the grace period when reporting hangs', () => {
    jest.useFakeTimers();
    const { target, exit } = setup(() => new Promise(() => undefined));

    target.emit('uncaughtException', new Error('boom'));
    jest.advanceTimersByTime(60);

    expect(exit).toHaveBeenCalledWith(1);
    jest.useRealTimers();
  });
});
