import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { PaystackIpMiddleware } from '../middleware/paystack-ip.middleware';

describe('PaystackIpMiddleware', () => {
  const createConfigService = (nodeEnv: string, paystackKey?: string) =>
    ({
      get: jest.fn((key: string) => {
        if (key === 'NODE_ENV') return nodeEnv;
        if (key === 'PAYSTACK_SECRET_KEY') return paystackKey;
        return undefined;
      }),
    }) as unknown as ConfigService;

  const createMockReq = (
    headers: Record<string, string | string[]>,
    ip = '127.0.0.1',
  ): Request =>
    ({
      headers,
      ip,
      socket: { remoteAddress: ip },
      path: '/api/v1/payments/webhook',
    }) as unknown as Request;

  const mockRes = {} as Response;
  const mockNext = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Non-production environments', () => {
    it('bypasses IP check when NODE_ENV is development', () => {
      const middleware = new PaystackIpMiddleware(
        createConfigService('development'),
      );
      const req = createMockReq({}, '192.168.1.1');

      middleware.use(req, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('bypasses IP check when NODE_ENV is test', () => {
      const middleware = new PaystackIpMiddleware(createConfigService('test'));
      const req = createMockReq({}, '10.0.0.1');

      middleware.use(req, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);
    });
  });

  describe('Production environment', () => {
    let middleware: PaystackIpMiddleware;

    beforeEach(() => {
      middleware = new PaystackIpMiddleware(createConfigService('production'));
    });

    it('allows requests directly from a valid Paystack IP', () => {
      const req = createMockReq({}, '52.31.139.75');

      middleware.use(req, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('allows a request whose edge header (true-client-ip) is a Paystack IP', () => {
      const req = createMockReq(
        { 'true-client-ip': '52.49.173.169' },
        '10.31.172.142',
      );

      middleware.use(req, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('allows a request whose cf-connecting-ip is a Paystack IP', () => {
      const req = createMockReq(
        { 'cf-connecting-ip': ' 52.214.14.220 ' },
        '172.68.1.1',
      );

      middleware.use(req, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('uses the proxy-resolved req.ip when there is no edge header', () => {
      const req = createMockReq({}, '52.31.139.75');

      middleware.use(req, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('blocks requests from unauthorized IPs in production', () => {
      const req = createMockReq({ 'true-client-ip': '185.220.101.5' });

      expect(() => middleware.use(req, mockRes, mockNext)).toThrow(
        UnauthorizedException,
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('ignores a forged x-forwarded-for that names a Paystack IP', () => {
      // The caller writes the leftmost x-forwarded-for value, so it proves nothing.
      const req = createMockReq(
        { 'x-forwarded-for': '52.31.139.75', 'true-client-ip': '198.51.100.1' },
        '198.51.100.1',
      );

      expect(() => middleware.use(req, mockRes, mockNext)).toThrow(
        UnauthorizedException,
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('ignores x-forwarded-for entirely when the real peer is not Paystack', () => {
      const req = createMockReq(
        { 'x-forwarded-for': '52.214.14.220' },
        '203.0.113.9',
      );

      expect(() => middleware.use(req, mockRes, mockNext)).toThrow(
        UnauthorizedException,
      );
    });

    it('bypasses IP check in production when using sk_test_ key for testing', () => {
      const testKeyMiddleware = new PaystackIpMiddleware(
        createConfigService('production', 'sk_test_mock123'),
      );
      const req = createMockReq({ 'x-forwarded-for': '185.220.101.5' });

      testKeyMiddleware.use(req, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);
    });
  });
});
