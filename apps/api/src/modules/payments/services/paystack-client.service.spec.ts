import {
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac } from 'crypto';
import { upstreamStatusOf } from '@api/infrastructure/resilience/dependency-failure.util';
import { PaystackClientService } from './paystack-client.service';

const SECRET = 'sk_test_unit_secret';

describe('PaystackClientService', () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch');
  let breaker: {
    executePaystack: jest.Mock;
    executePaystackRepeatable: jest.Mock;
  };
  let configured: string | undefined;
  let client: PaystackClientService;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });

  beforeEach(() => {
    configured = SECRET;
    breaker = {
      executePaystack: jest.fn((fn: () => unknown) => fn()),
      executePaystackRepeatable: jest.fn((fn: () => unknown) => fn()),
    };
    const config = {
      get: jest.fn(() => configured),
      getOrThrow: jest.fn(() => {
        if (configured === undefined) throw new Error('missing');
        return configured;
      }),
    };
    client = new PaystackClientService(config as never, breaker as never);
    jest
      .spyOn((client as any).logger, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => fetchMock.mockReset());
  afterAll(() => fetchMock.mockRestore());

  describe('post', () => {
    it('sends the body with the secret key, through the Paystack breaker, with a timeout', async () => {
      fetchMock.mockResolvedValue(json({ status: true, data: { id: 1 } }));

      const result = await client.post('https://api.paystack.co/x', { a: 1 });

      expect(result).toEqual({ status: true, data: { id: 1 } });
      expect(breaker.executePaystack).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.paystack.co/x');
      expect(init).toMatchObject({
        method: 'POST',
        body: '{"a":1}',
        headers: {
          Authorization: `Bearer ${SECRET}`,
          'Content-Type': 'application/json',
        },
      });
      expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
    });

    it('is never retried: a post can create or charge', async () => {
      fetchMock.mockResolvedValue(json({ message: 'down' }, 503));

      await expect(
        client.post('https://api.paystack.co/x', {}),
      ).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(breaker.executePaystackRepeatable).not.toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('goes through the repeatable breaker policy: a read is safe to retry', async () => {
      fetchMock.mockResolvedValue(json({ status: true }));

      await client.get('https://api.paystack.co/y');

      expect(breaker.executePaystackRepeatable).toHaveBeenCalledTimes(1);
      expect(breaker.executePaystack).not.toHaveBeenCalled();
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'GET' });
    });
  });

  describe('response handling', () => {
    const failure = async (status: number, body: unknown) =>
      client.get('https://api.paystack.co/y').catch((e: unknown) => e);

    it('returns the parsed body on success', async () => {
      fetchMock.mockResolvedValue(json({ status: true, message: 'ok' }));

      await expect(client.get('https://api.paystack.co/y')).resolves.toEqual({
        status: true,
        message: 'ok',
      });
    });

    it('answers 503 for a body that is not JSON', async () => {
      fetchMock.mockResolvedValue(
        new Response('<html>bad gateway</html>', { status: 502 }),
      );

      const error = await failure(502, null);

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as Error).message).toBe('Invalid Paystack API response.');
    });

    it("answers 503 with Paystack's message, but keeps the real upstream status for the breaker", async () => {
      fetchMock.mockResolvedValue(json({ message: 'Invalid amount' }, 400));

      const error = await failure(400, null);

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as Error).message).toBe('Invalid amount');
      expect(upstreamStatusOf(error)).toBe(400);
    });

    it.each([401, 403])(
      'reports a configuration problem for HTTP %i without leaking the key',
      async (status) => {
        fetchMock.mockResolvedValue(json({ message: 'whatever' }, status));

        const error = (await failure(status, null)) as Error;

        expect(error.message).toBe(
          'Paystack authentication failed. Check PAYSTACK_SECRET_KEY.',
        );
        expect(error.message).not.toContain(SECRET);
        expect(upstreamStatusOf(error)).toBe(status);
      },
    );

    it('treats an "invalid key" message as an authentication failure whatever the status', async () => {
      fetchMock.mockResolvedValue(json({ message: 'Invalid Key' }, 400));

      const error = (await failure(400, null)) as Error;

      expect(error.message).toMatch(/authentication failed/);
    });

    it('falls back to the HTTP status when Paystack gives no message', async () => {
      fetchMock.mockResolvedValue(json({}, 500));

      const error = (await failure(500, null)) as Error;

      expect(error.message).toBe('Paystack returned HTTP 500.');
    });
  });

  describe('verifyTransaction', () => {
    it('reads the transaction by its reference, encoded', async () => {
      fetchMock.mockResolvedValue(
        json({ status: true, data: { status: 'success' } }),
      );

      const result = await client.verifyTransaction('ref/with space');

      expect(result).toEqual({ status: true, data: { status: 'success' } });
      expect(fetchMock.mock.calls[0][0] as string).toContain(
        'ref%2Fwith%20space',
      );
    });

    it('answers null instead of throwing, so settlement can fall back to the signed webhook', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));

      await expect(client.verifyTransaction('ref')).resolves.toBeNull();
    });
  });

  describe('webhook signature', () => {
    const sign = (body: string, secret = SECRET) =>
      createHmac('sha512', secret).update(body).digest('hex');

    it('accepts the signature of the exact body', () => {
      expect(client.isValidWebhookSignature('{"a":1}', sign('{"a":1}'))).toBe(
        true,
      );
    });

    it('accepts it with stray spaces around the header value', () => {
      expect(
        client.isValidWebhookSignature('{"a":1}', `  ${sign('{"a":1}')} `),
      ).toBe(true);
    });

    it.each([
      [
        'a body changed by one byte',
        () => client.isValidWebhookSignature('{"a":2}', sign('{"a":1}')),
      ],
      [
        'a signature made with another key',
        () =>
          client.isValidWebhookSignature('{"a":1}', sign('{"a":1}', 'other')),
      ],
      [
        'a signature of the wrong length',
        () => client.isValidWebhookSignature('{"a":1}', 'abc'),
      ],
      [
        'an empty signature',
        () => client.isValidWebhookSignature('{"a":1}', ''),
      ],
    ])('rejects %s', (_label, check) => {
      expect(check()).toBe(false);
    });

    it('rejects everything when the key is not configured, instead of throwing', () => {
      configured = undefined;

      expect(client.isValidWebhookSignature('{"a":1}', sign('{"a":1}'))).toBe(
        false,
      );
    });
  });

  describe('configuration', () => {
    it('passes when a key is set', () => {
      expect(() => client.assertConfigured()).not.toThrow();
    });

    it.each([undefined, '', '   '])(
      'refuses to run with the key %p',
      (value) => {
        configured = value;

        expect(() => client.assertConfigured()).toThrow(
          InternalServerErrorException,
        );
      },
    );

    it('will not send a request without a key', async () => {
      configured = '   ';

      await expect(client.get('https://api.paystack.co/y')).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
