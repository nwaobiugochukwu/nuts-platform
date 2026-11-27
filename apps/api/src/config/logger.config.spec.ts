import { runWithRequestId } from '@api/common/request-context/request-context';
import { logProgram, pinoLoggerConfig } from './logger.config';

describe('logProgram', () => {
  it('names the program, preferring LOG_PROGRAM, then PROCESS_ROLE, then all', () => {
    expect(
      logProgram({
        LOG_PROGRAM: 'temporal-worker',
        PROCESS_ROLE: 'all',
      }),
    ).toBe('temporal-worker');
    expect(logProgram({ PROCESS_ROLE: 'Worker' })).toBe('worker');
    expect(logProgram({})).toBe('all');
  });
});

describe('pinoLoggerConfig mixin', () => {
  const mixin = () =>
    (
      pinoLoggerConfig().pinoHttp as { mixin: () => Record<string, unknown> }
    ).mixin();

  it('adds the program to every line', () => {
    expect(mixin()).toEqual({ program: logProgram() });
  });

  it('adds the request id too while a request is being handled', () => {
    expect(runWithRequestId('req-log-mixin-1', mixin)).toEqual({
      program: logProgram(),
      requestId: 'req-log-mixin-1',
    });
  });
});
