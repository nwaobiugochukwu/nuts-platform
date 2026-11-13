import {
  Injectable,
  Logger,
  NestMiddleware,
  PayloadTooLargeException,
} from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { SECURITY } from '@api/common/constants';

/**
 * Middleware to enforce a maximum request body size (10mb).
 * This is an additional layer beyond the express body-parser limit.
 */
@Injectable()
export class BodySizeMiddleware implements NestMiddleware {
  private readonly logger = new Logger(BodySizeMiddleware.name);
  private readonly maxSize = SECURITY.MAX_BODY_SIZE_BYTES;

  use(req: Request, res: Response, next: NextFunction): void {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);

    if (contentLength > this.maxSize) {
      this.logger.warn(
        { contentLength, maxSize: this.maxSize, path: req.path },
        'Request body too large',
      );
      throw new PayloadTooLargeException(
        `Request body exceeds the maximum allowed size of ${this.maxSize / (1024 * 1024)}MB`,
      );
    }

    next();
  }
}
