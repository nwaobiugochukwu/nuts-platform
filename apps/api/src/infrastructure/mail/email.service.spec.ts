import { EmailService } from './email.service';

describe('EmailService new-device sign-in email', () => {
  const send = jest.fn().mockResolvedValue(undefined);
  let service: EmailService;

  beforeEach(() => {
    send.mockClear();
    service = new EmailService(
      { send, verifyConnection: jest.fn() } as never,
      { executeEmail: (fn: () => Promise<unknown>) => fn() } as never,
    );
    jest
      .spyOn((service as any).logger, 'log')
      .mockImplementation(() => undefined);
  });

  it('tells the customer the device, the time in Lagos and the address, and what to do', async () => {
    await service.sendNewDeviceLoginEmail('ada@example.com', 'Ada', {
      device: 'Safari on iOS',
      ip: '102.89.1.1',
      signedInAt: new Date('2026-11-28T10:00:00.000Z'),
    });

    const message = send.mock.calls[0][0];
    expect(message.to).toBe('ada@example.com');
    expect(message.subject).toBe('New sign-in to your NUTS account');
    expect(message.html).toContain('Hello Ada');
    expect(message.html).toContain('Safari on iOS');
    expect(message.html).toContain('102.89.1.1');
    expect(message.html).toContain('11:00'); // 10:00 UTC is 11:00 in Lagos
    expect(message.html).toMatch(/reset your\s+password/);
  });

  it('escapes anything that came from the browser, so a crafted User-Agent cannot inject markup', async () => {
    await service.sendNewDeviceLoginEmail('ada@example.com', '<b>Ada</b>', {
      device: '<script>alert(1)</script>',
      ip: '"><img src=x>',
      signedInAt: new Date(),
    });

    const html: string = send.mock.calls[0][0].html;
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x>');
    expect(html).not.toContain('<b>Ada</b>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('copes with an unknown address', async () => {
    await service.sendNewDeviceLoginEmail('ada@example.com', '', {
      device: 'Unknown device',
      ip: null,
      signedInAt: new Date(),
    });

    expect(send.mock.calls[0][0].html).toContain('not available');
    expect(send.mock.calls[0][0].html).toContain('Hello Customer');
  });
});
