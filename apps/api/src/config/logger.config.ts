import { randomUUID } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { Params } from 'nestjs-pino';
import { currentRequestId } from '@api/common/request-context/request-context.util';

/**
 * Which program wrote a log line (api, worker, jobs, all, workflow-worker). Added
 * to every line so interleaved output, and logs shipped from several services,
 * can be told apart.
 */
export function logProgram(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.LOG_PROGRAM?.trim() || env.PROCESS_ROLE?.trim().toLowerCase() || 'all'
  );
}

export const pinoLoggerConfig = (): Params => {
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    forRoutes: ['*path'],
    pinoHttp: {
      level: isProduction ? 'info' : 'debug',
      ...(isProduction
        ? {}
        : {
            transport: {
              target: 'pino-pretty',
              options: {
                singleLine: true,
                colorize: true,
                // Show which program wrote the line, e.g. "[worker] ...", since the
                // programs share one terminal in `npm run dev`.
                messageFormat: '[{program}] {msg}',
                ignore: 'hostname,program',
              },
            },
          }),
      // Every log line written while a request (or a message it caused) is being
      // handled carries its id, including logs from consumers and workers.
      mixin: () => {
        const requestId = currentRequestId();
        return requestId
          ? { program: logProgram(), requestId }
          : { program: logProgram() };
      },
      genReqId: (req: IncomingMessage, res: ServerResponse) => {
        const header = req.headers['x-request-id'];
        const candidate = Array.isArray(header) ? header[0] : header;
        const requestId =
          typeof candidate === 'string' &&
          /^[a-zA-Z0-9_-]{16,64}$/.test(candidate)
            ? candidate
            : randomUUID();
        res.setHeader('X-Request-Id', requestId);
        return requestId;
      },
      customProps: (req: IncomingMessage) => ({
        requestId: String((req as IncomingMessage & { id?: string }).id ?? ''),
      }),
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers.x-csrf-token',
          'req.headers.x-otp-code',
          'res.headers.set-cookie',
          'req.body.password',
          'req.body.currentPassword',
          'req.body.newPassword',
          'req.body.refreshToken',
          'req.body.accessToken',
        ],
        remove: true,
      },
      autoLogging: {
        ignore: (req: IncomingMessage) => req.url?.includes('/health') ?? false,
      },
    },
  };
};
