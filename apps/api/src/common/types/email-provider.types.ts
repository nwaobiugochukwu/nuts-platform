export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(options: SendEmailOptions): Promise<void>;
  verifyConnection(): Promise<boolean>;
}
