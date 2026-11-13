import type { NextFunction, Request, Response } from 'express';
import { CsrfMiddleware } from './csrf.middleware';

describe('CsrfMiddleware', () => {
  const token = 'a'.repeat(64);
  let middleware: CsrfMiddleware;
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: jest.MockedFunction<NextFunction>;
  let status: jest.Mock;
  let json: jest.Mock;

  beforeEach(() => {
    middleware = new CsrfMiddleware(['https://shop.example.com']);
    req = {
      method: 'POST',
      path: '/api/v1/orders',
      ip: '127.0.0.1',
      headers: {
        origin: 'https://shop.example.com',
        'sec-fetch-site': 'same-site',
        'x-csrf-token': token,
      },
      cookies: { csrf_token: token },
    };
    status = jest.fn().mockReturnThis();
    json = jest.fn().mockReturnThis();
    res = { status, json };
    next = jest.fn();
  });

  it('accepts a trusted origin with a matching CSRF cookie and header', () => {
    middleware.use(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it('rejects an untrusted origin before route execution', () => {
    req.headers = { ...req.headers, origin: 'https://attacker.example' };
    middleware.use(req as Request, res as Response, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a valid-looking header when the CSRF cookie is missing', () => {
    req.cookies = {};
    middleware.use(req as Request, res as Response, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows bearer-authenticated requests without a CSRF cookie', () => {
    req.cookies = {};
    req.headers = {
      ...req.headers,
      authorization: 'Bearer access-token',
    };
    middleware.use(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it('accepts a trusted origin even when sec-fetch-site is cross-site', () => {
    req.headers = {
      ...req.headers,
      'sec-fetch-site': 'cross-site',
    };
    middleware.use(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it('rejects cross-site requests missing an origin header', () => {
    delete req.headers?.origin;
    req.headers = {
      ...req.headers,
      'sec-fetch-site': 'cross-site',
    };
    middleware.use(req as Request, res as Response, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('normalizes trailing slashes and paths in allowed origins', () => {
    const customMiddleware = new CsrfMiddleware([
      'https://nuts-platform-web-staging.onrender.com/',
      'http://localhost:5173/app',
    ]);
    req.headers = {
      ...req.headers,
      origin: 'https://nuts-platform-web-staging.onrender.com',
      'sec-fetch-site': 'cross-site',
    };
    customMiddleware.use(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it('allows unauthenticated login from a trusted origin without a pre-existing CSRF cookie', () => {
    Object.defineProperty(req, 'path', {
      value: '/api/v1/auth/login',
      configurable: true,
    });
    req.cookies = {};
    const cookieMock = jest.fn();
    const setHeaderMock = jest.fn();
    res.cookie = cookieMock;
    res.setHeader = setHeaderMock;

    middleware.use(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
    expect(cookieMock).toHaveBeenCalledWith(
      'csrf_token',
      expect.any(String),
      expect.any(Object),
    );
    expect(setHeaderMock).toHaveBeenCalledWith(
      'x-csrf-token',
      expect.any(String),
    );
  });

  it('rejects unauthenticated login from an untrusted origin', () => {
    Object.defineProperty(req, 'path', {
      value: '/api/v1/auth/login',
      configurable: true,
    });
    req.headers = { ...req.headers, origin: 'https://evil.example.com' };
    middleware.use(req as Request, res as Response, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('sets SameSite=None and Secure when COOKIE_SAME_SITE is set to none', () => {
    process.env.COOKIE_SAME_SITE = 'none';
    const noneMiddleware = new CsrfMiddleware([
      'https://nuts-staging.onrender.com',
    ]);
    req.headers = {
      origin: 'https://nuts-staging.onrender.com',
      host: 'nuts-api-staging.onrender.com',
    };
    req.method = 'GET';
    req.cookies = {};
    const cookieMock = jest.fn();
    res.cookie = cookieMock;
    res.setHeader = jest.fn();

    noneMiddleware.use(req as Request, res as Response, next);
    expect(cookieMock).toHaveBeenCalledWith(
      'csrf_token',
      expect.any(String),
      expect.objectContaining({
        sameSite: 'none',
        secure: true,
      }),
    );
    delete process.env.COOKIE_SAME_SITE;
  });

  it('allows unauthenticated login with trailing slash from a trusted origin', () => {
    Object.defineProperty(req, 'path', {
      value: '/api/v1/auth/login/',
      configurable: true,
    });
    req.cookies = {};
    res.cookie = jest.fn();
    res.setHeader = jest.fn();

    middleware.use(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it('allows payment webhooks without CSRF cookies from trusted origin', () => {
    Object.defineProperty(req, 'path', {
      value: '/api/v1/payments/webhook',
      configurable: true,
    });
    req.cookies = {};
    res.cookie = jest.fn();
    res.setHeader = jest.fn();

    middleware.use(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it('allows vendor and admin auth actions across versioned paths', () => {
    Object.defineProperty(req, 'path', {
      value: '/api/v2/vendors/auth/register',
      configurable: true,
    });
    req.cookies = {};
    res.cookie = jest.fn();
    res.setHeader = jest.fn();

    middleware.use(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it('allows token refresh without pre-existing CSRF cookie from trusted origin', () => {
    Object.defineProperty(req, 'path', {
      value: '/api/v1/auth/refresh',
      configurable: true,
    });
    req.cookies = {};
    res.cookie = jest.fn();
    res.setHeader = jest.fn();

    middleware.use(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
    expect(res.cookie).toHaveBeenCalledWith(
      'csrf_token',
      expect.any(String),
      expect.any(Object),
    );
  });

  it('allows logout without pre-existing CSRF cookie from trusted origin', () => {
    Object.defineProperty(req, 'path', {
      value: '/api/v1/auth/logout',
      configurable: true,
    });
    req.cookies = {};
    res.cookie = jest.fn();
    res.setHeader = jest.fn();

    middleware.use(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it('allows OTP request endpoints without pre-existing CSRF cookie from trusted origin', () => {
    Object.defineProperty(req, 'path', {
      value: '/api/v1/auth/otp/request',
      configurable: true,
    });
    req.cookies = {};
    res.cookie = jest.fn();
    res.setHeader = jest.fn();

    middleware.use(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it('allows referral code validation without pre-existing CSRF cookie from trusted origin', () => {
    Object.defineProperty(req, 'path', {
      value: '/api/v1/account/referral/validate',
      configurable: true,
    });
    req.cookies = {};
    res.cookie = jest.fn();
    res.setHeader = jest.fn();

    middleware.use(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it('allows account reactivation without pre-existing CSRF cookie from trusted origin', () => {
    Object.defineProperty(req, 'path', {
      value: '/api/v1/account/reactivate',
      configurable: true,
    });
    req.cookies = {};
    res.cookie = jest.fn();
    res.setHeader = jest.fn();

    middleware.use(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it('bypasses CSRF cookie generation entirely for SSE stream connections', () => {
    Object.defineProperty(req, 'path', {
      value: '/api/v1/notifications/sse/stream',
      configurable: true,
    });
    req.method = 'GET';
    req.headers = { ...req.headers, accept: 'text/event-stream' };
    req.cookies = {};
    const cookieMock = jest.fn();
    const setHeaderMock = jest.fn();
    res.cookie = cookieMock;
    res.setHeader = setHeaderMock;

    middleware.use(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(cookieMock).not.toHaveBeenCalled();
    expect(setHeaderMock).not.toHaveBeenCalled();
  });

  it('preserves existing valid CSRF cookie on read-only GET requests without re-issuing Set-Cookie', () => {
    const existingToken = 'a'.repeat(64);
    Object.defineProperty(req, 'path', {
      value: '/api/v1/products',
      configurable: true,
    });
    req.method = 'GET';
    req.cookies = { csrf_token: existingToken };
    const cookieMock = jest.fn();
    const setHeaderMock = jest.fn();
    res.cookie = cookieMock;
    res.setHeader = setHeaderMock;

    middleware.use(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(cookieMock).not.toHaveBeenCalled();
    expect(setHeaderMock).toHaveBeenCalledWith('x-csrf-token', existingToken);
  });
});
