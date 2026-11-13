import { randomUUID } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { Params } from 'nestjs-pino';

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
              options: { singleLine: true, colorize: true },
            },
          }),
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
