import type { NextFunction, Request, Response } from 'express';
import { BotDetectionMiddleware } from './bot-detection.middleware';

describe('BotDetectionMiddleware', () => {
  let middleware: BotDetectionMiddleware;
  let req: any;
  let res: Partial<Response>;
  let next: jest.MockedFunction<NextFunction>;
  let status: jest.Mock;
  let json: jest.Mock;

  beforeEach(() => {
    middleware = new BotDetectionMiddleware();
    status = jest.fn().mockReturnThis();
    json = jest.fn().mockReturnThis();
    res = { status, json };
    next = jest.fn();

    // Default legitimate browser request
    req = {
      method: 'GET',
      path: '/api/v1/products',
      ip: '192.168.1.100',
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        host: 'api.example.com',
        accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'accept-encoding': 'gzip, deflate, br',
        'upgrade-insecure-requests': '1',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'navigate',
      },
    };
  });

  describe('Bypass Paths & Methods', () => {
    it('bypasses OPTIONS requests without scoring', () => {
      req.method = 'OPTIONS';
      req.headers = {}; // stripped headers that would normally fail

      middleware.use(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(status).not.toHaveBeenCalled();
    });

    it('bypasses root health probe /', () => {
      req.path = '/';
      req.headers = {};

      middleware.use(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(status).not.toHaveBeenCalled();
    });

    it('bypasses /health and /api/v1/health', () => {
      req.path = '/api/v1/health';
      req.headers = {};

      middleware.use(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(status).not.toHaveBeenCalled();
    });
  });

  describe('Layer 1: Hard Block Known Bad User-Agents', () => {
    it.each([
      'sqlmap/1.5#stable',
      'Nikto/2.1.6',
      'curl/7.88.1',
      'Wget/1.21.3',
      'python-requests/2.28.1',
      'Scrapy/2.8.0 (+https://scrapy.org)',
      'Nmap Scripting Engine',
    ])('rejects scanner/bot UA "%s" with 403 Forbidden', (badUa) => {
      req.headers!['user-agent'] = badUa;

      middleware.use(req as Request, res as Response, next);

      expect(status).toHaveBeenCalledWith(403);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({ code: 'BOT_DETECTED' }),
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('Layer 2: Heuristic Scoring Engine', () => {
    it('allows a legitimate modern browser request through to next()', () => {
      middleware.use(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(status).not.toHaveBeenCalled();
    });

    it('rejects automated headless browsers with 429 Too Many Requests', () => {
      req.headers!['user-agent'] =
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/118.0.5993.88 Safari/537.36';
      // Missing language and encoding
      delete req.headers!['accept-language'];
      delete req.headers!['accept-encoding'];

      middleware.use(req as Request, res as Response, next);

      expect(status).toHaveBeenCalledWith(429);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({ code: 'BOT_DETECTED' }),
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects requests with empty User-Agent and stripped standard headers', () => {
      req.headers = {
        host: 'api.example.com',
      }; // empty UA + missing accept + missing language + missing encoding

      middleware.use(req as Request, res as Response, next);

      expect(status).toHaveBeenCalledWith(429);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects POST request without Content-Type and browser headers', () => {
      req.method = 'POST';
      req.path = '/api/v1/auth/login';
      req.headers = {
        'user-agent': 'GenericClient/1.0', // short UA
        host: 'api.example.com',
        // missing accept, accept-language, accept-encoding, content-type
      };

      middleware.use(req as Request, res as Response, next);

      expect(status).toHaveBeenCalledWith(429);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
