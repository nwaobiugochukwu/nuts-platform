import { ConfigService } from '@nestjs/config';
import { BrevoProvider } from './brevo.provider';

describe('BrevoProvider', () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch');

  afterEach(() => {
    fetchMock.mockReset();
  });

  afterAll(() => {
    fetchMock.mockRestore();
  });

  function createProvider(config: Record<string, string>) {
    const configService = {
      get: (key: string) => config[key],
    } as ConfigService;

    return new BrevoProvider(configService);
  }

  it('sends through the Brevo HTTPS API with sender, recipients, and attachment', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 201 }));
    const provider = createProvider({
      BREVO_API_KEY: 'brevo-test-key',
      EMAIL_FROM: 'NUTS <sender@example.com>',
    });

    await provider.send({
      to: ['customer@example.com'],
      subject: 'Your receipt',
      html: '<p>Thanks</p>',
      text: 'Thanks',
      replyTo: 'support@example.com',
      attachments: [
        {
          filename: 'receipt.pdf',
          content: Buffer.from('receipt'),
          contentType: 'application/pdf',
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.brevo.com/v3/smtp/email',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'api-key': 'brevo-test-key',
          'content-type': 'application/json',
        }),
      }),
    );

    const requestBody = fetchMock.mock.calls[0][1]?.body;
    if (typeof requestBody !== 'string') {
      throw new Error('Expected a JSON request body.');
    }
    const payload = JSON.parse(requestBody);
    expect(payload).toMatchObject({
      sender: { name: 'NUTS', email: 'sender@example.com' },
      to: [{ email: 'customer@example.com' }],
      replyTo: { email: 'support@example.com' },
      attachment: [
        {
          name: 'receipt.pdf',
          content: Buffer.from('receipt').toString('base64'),
        },
      ],
    });
  });

  it('verifies credentials with the Brevo account endpoint', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const provider = createProvider({
      BREVO_API_KEY: 'brevo-test-key',
      EMAIL_FROM: 'sender@example.com',
    });

    await expect(provider.verifyConnection()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.brevo.com/v3/account',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ 'api-key': 'brevo-test-key' }),
      }),
    );
  });

  it('does not send if the API key is missing', async () => {
    const provider = createProvider({ EMAIL_FROM: 'sender@example.com' });

    await expect(
      provider.send({
        to: 'customer@example.com',
        subject: 'Test',
        text: 'Test message',
      }),
    ).rejects.toThrow('BREVO_API_KEY is not configured.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects messages without HTML content before making a request', async () => {
    const provider = createProvider({
      BREVO_API_KEY: 'brevo-test-key',
      EMAIL_FROM: 'sender@example.com',
    });

    await expect(
      provider.send({
        to: 'customer@example.com',
        subject: 'Test',
        text: 'Test message',
      }),
    ).rejects.toThrow('Brevo transactional emails require HTML content.');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
