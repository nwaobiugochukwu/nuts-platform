import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EmailProvider,
  SendEmailOptions,
} from '@api/common/interfaces/email-provider.interface';

interface BrevoAddress {
  email: string;
  name?: string;
}

@Injectable()
export class BrevoProvider implements EmailProvider {
  readonly name = 'brevo';
  private readonly logger = new Logger(BrevoProvider.name);
  private readonly apiKey: string | undefined;
  private readonly sender: BrevoAddress | undefined;
  private readonly apiBaseUrl = 'https://api.brevo.com/v3';

  constructor(configService: ConfigService) {
    this.apiKey = configService.get<string>('BREVO_API_KEY')?.trim();

    const from = configService.get<string>('EMAIL_FROM')?.trim();
    this.sender = from ? this.parseSender(from) : undefined;
  }

  async send(options: SendEmailOptions): Promise<void> {
    if (!this.apiKey) {
      throw new Error('BREVO_API_KEY is not configured.');
    }
    if (!this.sender) {
      throw new Error('EMAIL_FROM must be configured with a valid sender.');
    }
    if (!options.html) {
      throw new Error('Brevo transactional emails require HTML content.');
    }

    const payload = {
      sender: this.sender,
      to: this.toAddresses(options.to),
      subject: options.subject,
      ...(options.html ? { htmlContent: options.html } : {}),
      ...(options.text ? { textContent: options.text } : {}),
      ...(options.cc ? { cc: this.toAddresses(options.cc) } : {}),
      ...(options.bcc ? { bcc: this.toAddresses(options.bcc) } : {}),
      ...(options.replyTo
        ? { replyTo: this.parseAddress(options.replyTo) }
        : {}),
      ...(options.attachments?.length
        ? {
            attachment: options.attachments.map((attachment) => ({
              name: attachment.filename,
              content: Buffer.isBuffer(attachment.content)
                ? attachment.content.toString('base64')
                : Buffer.from(attachment.content).toString('base64'),
            })),
          }
        : {}),
    };

    await this.request('/smtp/email', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async verifyConnection(): Promise<boolean> {
    if (!this.apiKey) {
      this.logger.warn(
        'BREVO_API_KEY is not configured; email sending is unavailable.',
      );
      return false;
    }

    try {
      await this.request('/account', { method: 'GET' });
      return true;
    } catch (error) {
      this.logger.error(
        `Brevo API verification failed: ${this.errorMessage(error)}`,
      );
      return false;
    }
  }

  private async request(
    path: string,
    init: Pick<RequestInit, 'method' | 'body'>,
  ): Promise<void> {
    if (!this.apiKey) {
      throw new Error('BREVO_API_KEY is not configured.');
    }

    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        'api-key': this.apiKey,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      const details = (await response.text()).slice(0, 500);
      throw new Error(
        `Brevo API request failed with status ${response.status}${details ? `: ${details}` : ''}`,
      );
    }
  }

  private toAddresses(value: string | string[]): BrevoAddress[] {
    return (Array.isArray(value) ? value : [value]).map((address) =>
      this.parseAddress(address),
    );
  }

  private parseSender(value: string): BrevoAddress {
    const formatted = /^(.*?)\s*<([^<>]+)>$/.exec(value);
    const email = (formatted?.[2] ?? value).trim();
    const name = formatted?.[1]?.trim().replace(/^["']|["']$/g, '');

    if (!this.isEmail(email)) {
      throw new Error('EMAIL_FROM must contain a valid email address.');
    }

    return {
      email,
      ...(name ? { name } : {}),
    };
  }

  private parseAddress(value: string): BrevoAddress {
    const email = value.trim();
    if (!this.isEmail(email)) {
      throw new Error('Email recipients must contain valid email addresses.');
    }
    return { email };
  }

  private isEmail(value: string): boolean {
    return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
