import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CircuitBreakerService } from '@api/modules/infrastructure/resiliency/circuit-breaker.service';
import {
  EmailProvider,
  SendEmailOptions,
} from '@api/modules/shared/interfaces/email-provider.interface';
import {
  generateInvoicePdf,
  PdfInvoiceData,
} from '@api/modules/shared/utils/pdf-generator.util';

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @Inject('EMAIL_PROVIDER')
    private readonly emailProvider: EmailProvider,
    private readonly circuitBreaker: CircuitBreakerService,
  ) {}

  /**
   * Verify provider credentials after Nest initializes the provider.
   */
  async onModuleInit(): Promise<void> {
    const verified = await this.emailProvider.verifyConnection();
    if (verified) {
      this.logger.log(
        `${this.emailProvider.name} email provider verified successfully`,
      );
    } else {
      this.logger.warn(
        `${this.emailProvider.name} email provider verification failed; email delivery may be unavailable`,
      );
    }
  }

  /**
   * Sends an OTP/verification email tailored to the specific purpose.
   */
  async sendOtpEmail(
    to: string,
    otp: string,
    options?: {
      subject?: string;
      orderDetails?: string;
      eyebrow?: string;
      title?: string;
      description?: string;
      purpose?: string;
    },
  ): Promise<void> {
    const copy = this.getOtpCopyByPurpose(options?.purpose);
    const subject = options?.subject || copy.subject;
    const eyebrow = options?.eyebrow || copy.eyebrow;
    const title = options?.title || copy.title;
    const description = options?.description || copy.description;

    const html = this.buildOtpHtml({
      otp,
      eyebrow,
      title,
      description,
      orderDetails: options?.orderDetails,
    });

    await this.sendEmail({
      to,
      subject,
      html,
    });

    // Do not log OTPs or unnecessary recipient information.
    this.logger.log(
      `OTP email sent successfully (purpose: ${options?.purpose || 'default'})`,
    );
  }

  /**
   * Sends the account welcome email for shoppers.
   */
  async sendWelcomeEmail(to: string, name: string): Promise<void> {
    await this.sendEmail({
      to,
      subject: 'Welcome to NUTS',
      html: this.buildWelcomeHtml(name),
    });

    this.logger.log('Customer welcome email sent successfully');
  }

  /**
   * Sends vendor registration receipt informing them their store is under review.
   */
  async sendVendorApplicationReceivedEmail(
    to: string,
    storeName: string,
    merchantName?: string,
  ): Promise<void> {
    await this.sendEmail({
      to,
      subject: 'NUTS Merchant Application Received — Pending Approval',
      html: this.buildVendorApplicationReceivedHtml(storeName, merchantName),
    });

    this.logger.log(`Vendor application received email sent to ${to}`);
  }

  /**
   * Sends vendor approval notification when store is activated by admin.
   */
  async sendVendorApprovedEmail(
    to: string,
    storeName: string,
    merchantName?: string,
  ): Promise<void> {
    await this.sendEmail({
      to,
      subject: '🎉 Congratulations! Your NUTS Merchant Store is Approved',
      html: this.buildVendorApprovedHtml(storeName, merchantName),
    });

    this.logger.log(`Vendor approval email sent to ${to}`);
  }

  /**
   * Sends confirmation after a successful password reset.
   */
  async sendPasswordResetSuccessEmail(to: string, name: string): Promise<void> {
    await this.sendEmail({
      to,
      subject: 'Password reset successful',
      html: this.buildPasswordResetHtml(name),
    });

    this.logger.log('Password reset confirmation email sent successfully');
  }

  /**
   * Generates an invoice PDF, attaches it to the order confirmation email,
   * and guarantees temporary-file cleanup.
   *
   * The PDF generator currently writes to a file, so we isolate each request
   * inside its own temporary directory. This prevents filename collisions when
   * multiple orders are processed concurrently.
   */
  async sendOrderConfirmation(to: string, data: PdfInvoiceData): Promise<void> {
    const subject = `Order Confirmation - ${data.orderNumber}`;

    await this.sendPdfEmail({
      to,
      subject,
      html: this.buildOrderConfirmationHtml(data),
      filename: `invoice_${this.sanitizeFilename(data.orderNumber)}.pdf`,
      temporaryPrefix: 'nuts-invoice-',
      data,
    });

    this.logger.log(
      `Order confirmation email sent successfully for order ${data.orderNumber}`,
    );
  }

  /**
   * Generates and sends a payment receipt.
   */
  async sendPaymentReceipt(to: string, data: PdfInvoiceData): Promise<void> {
    const subject = `Payment Receipt - ${data.orderNumber}`;

    await this.sendPdfEmail({
      to,
      subject,
      html: this.buildPaymentReceiptHtml(data),
      filename: `receipt_${this.sanitizeFilename(data.orderNumber)}.pdf`,
      temporaryPrefix: 'nuts-receipt-',
      data,
    });

    this.logger.log(
      `Payment receipt email sent successfully for order ${data.orderNumber}`,
    );
  }

  /**
   * Centralized email sending.
   *
   * Keeping provider calls in one place ensures every outgoing email uses the
   * same provider, circuit breaker, and safe error handling.
   */
  public async sendEmail(options: SendEmailOptions): Promise<void> {
    try {
      await this.circuitBreaker.executeEmail(async () => {
        await this.emailProvider.send(options);
      });
    } catch (error) {
      /**
       * Do not expose provider credentials or raw provider responses to the
       * caller. Log the technical error internally and return a safe error.
       */
      this.logger.error(
        `Failed to send email with subject "${options.subject ?? 'unknown'}"`,
        error instanceof Error ? error.stack : String(error),
      );

      throw new ServiceUnavailableException(
        'Unable to send email at this time.',
      );
    }
  }

  /**
   * Shared implementation for emails that require a generated PDF.
   *
   * The previous implementation duplicated this logic in both invoice and
   * receipt methods. Centralizing it prevents the two implementations from
   * drifting apart.
   */
  private async sendPdfEmail(params: {
    to: string;
    subject: string;
    html: string;
    filename: string;
    temporaryPrefix: string;
    data: PdfInvoiceData;
  }): Promise<void> {
    const temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), params.temporaryPrefix),
    );

    const pdfPath = path.join(temporaryDirectory, `${randomUUID()}.pdf`);

    try {
      /**
       * The existing PDF utility writes the generated document to disk.
       * We therefore use async filesystem operations instead of blocking
       * readFileSync/unlinkSync calls.
       */
      await generateInvoicePdf(params.data, pdfPath);

      const pdfBuffer = await fs.readFile(pdfPath);

      await this.sendEmail({
        to: params.to,
        subject: params.subject,
        html: params.html,
        attachments: [
          {
            filename: params.filename,
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
        ],
      });
    } finally {
      /**
       * rm with recursive + force safely removes the temporary directory
       * even when email generation/sending fails midway.
       */
      try {
        await fs.rm(temporaryDirectory, {
          recursive: true,
          force: true,
        });
      } catch (error) {
        this.logger.warn(
          `Failed to clean temporary email directory: ${temporaryDirectory}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  /**
   * Escapes dynamic values before inserting them into HTML.
   *
   * Email content contains customer/order data. Without escaping, a value
   * containing HTML could become executable markup in the email body.
   */
  private escapeHtml(value: unknown): string {
    const text =
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
        ? String(value)
        : value == null
          ? ''
          : (JSON.stringify(value) ?? '');
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Keeps generated attachment filenames safe.
   *
   * Order numbers should normally contain only safe characters, but this
   * prevents path separators and unexpected filesystem characters from
   * becoming part of a filename.
   */
  private sanitizeFilename(value: string): string {
    return (
      String(value)
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 100) || 'document'
    );
  }

  /**
   * Formats money consistently throughout email templates.
   */
  private formatMoney(currency: string, amount: number): string {
    const normalizedCurrency = this.escapeHtml(currency).toUpperCase();

    return `${normalizedCurrency} ${Number(amount).toFixed(2)}`;
  }

  /**
   * Returns domain-tailored email copywriting matching the exact security context.
   */
  private getOtpCopyByPurpose(purpose?: string): {
    eyebrow: string;
    title: string;
    description: string;
    subject: string;
  } {
    switch (purpose) {
      case 'account-deactivation':
        return {
          eyebrow: 'Account Security Alert',
          title: 'Confirm Account Deactivation',
          description:
            'You recently requested to deactivate your NUTS account. If this was intentional, use the verification code below to authorize this action. You have a 60-day grace period to sign back in before permanent deletion:',
          subject: 'NUTS — Account Deactivation Verification Code',
        };
      case 'admin:action':
        return {
          eyebrow: 'Admin Security Authorization',
          title: 'Authorize Admin Action',
          description:
            'A sensitive administrative operation has been requested on the NUTS platform. Use the verification code below to authorize this operation:',
          subject: 'NUTS — Admin Security Action Verification Code',
        };
      case 'password-reset':
        return {
          eyebrow: 'Account Security',
          title: 'Reset Your Password',
          description:
            'We received a request to reset the password for your NUTS account. Use the verification code below to complete your password reset:',
          subject: 'NUTS — Password Reset Verification Code',
        };
      case 'vendor:password-reset':
        return {
          eyebrow: 'Merchant Security',
          title: 'Reset Merchant Password',
          description:
            'A password reset request was initiated for your NUTS Merchant account. Use the verification code below to establish a new password:',
          subject: 'NUTS — Merchant Password Reset Verification Code',
        };
      case 'vendor:registration':
        return {
          eyebrow: 'Merchant Partner Verification',
          title: 'Verify Your Merchant Account',
          description:
            'Thank you for partnering with NUTS. Please verify your merchant email address using the code below to activate your vendor dashboard:',
          subject: 'NUTS — Verify your Merchant Account',
        };
      case 'payment':
        return {
          eyebrow: 'Payment Authorization',
          title: 'Authorize Checkout Payment',
          description:
            'A verification code is required to authorize your order payment on NUTS. Use the code below to complete your checkout:',
          subject: 'NUTS — Payment Authorization Code',
        };
      case 'email-verification':
        return {
          eyebrow: 'Email Verification',
          title: 'Verify Your Email Address',
          description:
            'Please verify that this is your email address for your NUTS account. Use the code below to proceed:',
          subject: 'NUTS — Email Verification Code',
        };
      case 'registration':
      default:
        return {
          eyebrow: 'Account Verification',
          title: 'Verify Your NUTS Account',
          description:
            'Welcome to NUTS! Please enter the 6-digit verification code below to confirm your email and activate your account:',
          subject: 'NUTS — Verify your email address',
        };
    }
  }

  private buildOtpHtml(params: {
    otp: string;
    eyebrow: string;
    title: string;
    description: string;
    orderDetails?: string;
  }): string {
    const safeOtp = this.escapeHtml(params.otp);
    const safeEyebrow = this.escapeHtml(params.eyebrow);
    const safeTitle = this.escapeHtml(params.title);
    const safeDescription = this.escapeHtml(params.description);

    const detailsHtml = params.orderDetails
      ? `
        <div class="details-box">
          <p>${this.escapeHtml(params.orderDetails)}</p>
        </div>
      `
      : '';

    return this.wrapHtml(`
      <div class="email-header">
        <p class="eyebrow">${safeEyebrow}</p>
        <h1>${safeTitle}</h1>
      </div>

      <div class="email-body">
        ${detailsHtml}

        <p>${safeDescription}</p>

        <div class="otp-box">
          <span>${safeOtp}</span>
        </div>

        <p>
          This verification code will expire in 10 minutes. If you did not request this verification, please disregard this email or contact security support if you suspect unauthorized activity.
        </p>
      </div>
    `);
  }

  private buildWelcomeHtml(name: string): string {
    const safeName = this.escapeHtml(name || 'Customer');

    return this.wrapHtml(`
      <div class="email-header">
        <p class="eyebrow">Welcome aboard</p>
        <h1>Welcome to NUTS</h1>
      </div>

      <div class="email-body">
        <p>Hello ${safeName},</p>

        <p>
          Thanks for joining NUTS. Your customer account is ready,
          and you can now explore our curated collection of products.
        </p>

        <div class="hero-card">
          <p><strong>Ready to shop?</strong></p>
          <p>
            Discover top products, exclusive offers, and fast checkout.
          </p>
        </div>

        <p>
          We’re excited to have you with us. Happy shopping!
        </p>
      </div>
    `);
  }

  private buildVendorApplicationReceivedHtml(
    storeName: string,
    merchantName?: string,
  ): string {
    const safeStore = this.escapeHtml(storeName || 'Merchant Store');
    const safeName = this.escapeHtml(merchantName || 'Merchant Partner');

    return this.wrapHtml(`
      <div class="email-header">
        <p class="eyebrow">Merchant Onboarding</p>
        <h1>Application Received</h1>
      </div>

      <div class="email-body">
        <p>Hello ${safeName},</p>

        <p>
          Thank you for applying to sell on the NUTS Marketplace! We have received your registration for <strong>${safeStore}</strong>.
        </p>

        <div class="hero-card" style="background:#fefce8;border-left:4px solid #eab308;">
          <p><strong>Application Status: Pending Review</strong></p>
          <p>
            Our administration team reviews all vendor applications to ensure platform quality and security. This typically takes 1 business day.
          </p>
        </div>

        <p>
          <strong>What happens next?</strong>
        </p>
        <p>
          Once your store is approved by our team, you will receive an approval email with access to publish products, configure inventory, and start selling.
        </p>

        <p>
          If you have any questions or business documents to submit, reply directly to this email or reach us at <a href="mailto:support@nuts.com" style="color:#7c3aed;text-decoration:none;">support@nuts.com</a>.
        </p>
      </div>
    `);
  }

  private buildVendorApprovedHtml(
    storeName: string,
    merchantName?: string,
  ): string {
    const safeStore = this.escapeHtml(storeName || 'Merchant Store');
    const safeName = this.escapeHtml(merchantName || 'Merchant Partner');

    return this.wrapHtml(`
      <div class="email-header">
        <p class="eyebrow" style="color:#059669;">Store Approved</p>
        <h1>Your Store is Live!</h1>
      </div>

      <div class="email-body">
        <p>Hello ${safeName},</p>

        <p>
          Great news! Your merchant store <strong>${safeStore}</strong> has been reviewed and officially approved by the NUTS administration team.
        </p>

        <div class="hero-card" style="background:#ecfdf5;border-left:4px solid #059669;">
          <p><strong style="color:#065f46;">Your Merchant Portal is Ready</strong></p>
          <p style="color:#047857;">
            You can now log in, upload your products, configure variant stock, and begin receiving orders from customers across the platform.
          </p>
        </div>

        <p style="text-align:center;margin:30px 0;">
          <a href="https://nuts-platform.onrender.com/auth/vendor/login" style="display:inline-block;background:#7c3aed;color:#ffffff;padding:14px 28px;border-radius:8px;font-weight:600;text-decoration:none;">Go to Vendor Portal</a>
        </p>

        <p>
          Welcome to the NUTS merchant community! Let's build something great together.
        </p>
      </div>
    `);
  }

  private buildPasswordResetHtml(name: string): string {
    const safeName = this.escapeHtml(name || 'Customer');

    return this.wrapHtml(`
      <div class="email-header">
        <p class="eyebrow">Account security</p>
        <h1>Password reset complete</h1>
      </div>

      <div class="email-body">
        <p>Hello ${safeName},</p>

        <p>
          Your password has been successfully reset.
          If you did not make this change, please contact
          our support team immediately.
        </p>

        <div class="hero-card">
          <p><strong>Need help?</strong></p>
          <p>
            Reach out to support if anything looks unfamiliar.
          </p>
        </div>
      </div>
    `);
  }

  private buildOrderConfirmationHtml(data: PdfInvoiceData): string {
    const currency = data.currency;

    const itemsHtml = this.buildItemsHtml(data);

    const discountHtml =
      data.discountAmount > 0
        ? `
          <div class="summary-card">
            <div>
              <span>Subtotal</span>
              <strong>
                ${this.formatMoney(currency, data.totalAmount)}
              </strong>
            </div>

            <div>
              <span>
                Discount${
                  data.discountCode
                    ? ` (${this.escapeHtml(data.discountCode)})`
                    : ''
                }
              </span>

              <strong class="discount">
                -${this.formatMoney(currency, data.discountAmount)}
              </strong>
            </div>

            <div class="summary-total">
              <span><strong>Total</strong></span>
              <strong>
                ${this.formatMoney(currency, data.finalAmount)}
              </strong>
            </div>
          </div>
        `
        : `
          <div class="summary-card">
            <div>
              <span>Order total</span>
              <strong>
                ${this.formatMoney(currency, data.totalAmount)}
              </strong>
            </div>
          </div>
        `;

    return this.wrapHtml(`
      <div class="email-header">
        <p class="eyebrow">Order confirmation</p>
        <h1>Order received</h1>
      </div>

      <div class="email-body">
        <p>
          Hello ${this.escapeHtml(data.customerName)},
        </p>

        <p>
          Your order
          <strong>#${this.escapeHtml(data.orderNumber)}</strong>
          has been placed successfully.
          A proforma invoice is attached for your reference.
        </p>

        <div class="details-box">
          <p>
            Shipping to:
            ${this.escapeHtml(data.shippingAddress)}
          </p>
        </div>

        ${discountHtml}

        <table class="table">
          <thead>
            <tr>
              <th>Product</th>
              <th style="text-align: center;">Qty</th>
              <th style="text-align: right;">Price</th>
            </tr>
          </thead>

          <tbody>
            ${itemsHtml}
          </tbody>
        </table>
      </div>
    `);
  }

  private buildPaymentReceiptHtml(data: PdfInvoiceData): string {
    const currency = data.currency;

    const itemsHtml = this.buildItemsHtml(data);

    const discountHtml =
      data.discountAmount > 0
        ? `
          <div class="summary-card">
            <div>
              <span>Subtotal</span>
              <strong>
                ${this.formatMoney(currency, data.totalAmount)}
              </strong>
            </div>

            <div>
              <span>
                Discount${
                  data.discountCode
                    ? ` (${this.escapeHtml(data.discountCode)})`
                    : ''
                }
              </span>

              <strong class="discount">
                -${this.formatMoney(currency, data.discountAmount)}
              </strong>
            </div>

            <div class="summary-total">
              <span><strong>Total paid</strong></span>
              <strong>
                ${this.formatMoney(currency, data.finalAmount)}
              </strong>
            </div>
          </div>
        `
        : `
          <div class="summary-card">
            <div>
              <span>Total paid</span>
              <strong>
                ${this.formatMoney(currency, data.finalAmount)}
              </strong>
            </div>
          </div>
        `;

    return this.wrapHtml(`
      <div class="email-header">
        <p class="eyebrow">Payment received</p>
        <h1>Payment confirmed</h1>
      </div>

      <div class="email-body">
        <p>
          Hello ${this.escapeHtml(data.customerName)},
        </p>

        <p>
          We've successfully received your payment of
          <strong>
            ${this.formatMoney(currency, data.finalAmount)}
          </strong>
          for order
          <strong>#${this.escapeHtml(data.orderNumber)}</strong>.
        </p>

        ${discountHtml}

        <table class="table">
          <thead>
            <tr>
              <th>Product</th>
              <th style="text-align: center;">Qty</th>
              <th style="text-align: right;">Price</th>
            </tr>
          </thead>

          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <div class="hero-card">
          <p>
            Your receipt is attached for your records.
          </p>
        </div>
      </div>
    `);
  }

  /**
   * Builds the product table once and reuses it for both order confirmations
   * and payment receipts.
   */
  private buildItemsHtml(data: PdfInvoiceData): string {
    const currency = data.currency;

    return data.items
      .map((item) => {
        const variantHtml = item.variantName
          ? `
            <div class="variant-name">
              ${this.escapeHtml(item.variantName)}
            </div>
          `
          : '';

        return `
          <tr>
            <td>
              ${this.escapeHtml(item.productName)}
              ${variantHtml}
            </td>

            <td style="text-align: center;">
              ${this.escapeHtml(item.quantity)}
            </td>

            <td style="text-align: right;">
              ${this.formatMoney(currency, item.price)}
            </td>
          </tr>
        `;
      })
      .join('');
  }

  /**
   * Shared email document shell.
   *
   * Keeping the layout in one place means all NUTS emails have consistent
   * rendering and styling.
   */
  private wrapHtml(content: string): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />

          <meta
            name="viewport"
            content="width=device-width,initial-scale=1"
          />

          <meta
            name="color-scheme"
            content="light"
          />

          <style>
            body {
              margin: 0;
              padding: 24px 12px;
              background: #f4f6f8;
              font-family:
                -apple-system,
                BlinkMacSystemFont,
                "Segoe UI",
                sans-serif;
            }

            .container {
              width: 100%;
              max-width: 600px;
              box-sizing: border-box;
              margin: 0 auto;
              padding: 24px;
              background: #ffffff;
              border-radius: 20px;
              box-shadow:
                0 24px 60px rgba(15, 23, 42, 0.08);
            }

            .email-header {
              text-align: center;
              padding-bottom: 24px;
              border-bottom: 1px solid #e2e8f0;
            }

            .eyebrow {
              margin: 0 0 8px;
              font-size: 12px;
              letter-spacing: 1.5px;
              color: #7c3aed;
              text-transform: uppercase;
            }

            .email-header h1 {
              margin: 0;
              font-size: 28px;
              line-height: 1.1;
              color: #111827;
            }

            .email-body {
              padding-top: 24px;
              color: #475569;
              line-height: 1.7;
            }

            .email-body p {
              margin: 0 0 18px;
            }

            .details-box {
              background: #eef2ff;
              border-radius: 14px;
              padding: 16px;
              margin: 0 0 18px;
              color: #1e293b;
            }

            .details-box p {
              margin: 0;
              font-weight: 600;
            }

            .otp-box,
            .hero-card,
            .summary-card {
              background: #f8fafc;
              border-radius: 16px;
              padding: 20px;
              margin: 18px 0;
            }

            .otp-box span {
              display: block;
              text-align: center;
              font-size: 28px;
              letter-spacing: 12px;
              font-weight: 700;
              color: #111827;
            }

            .hero-card p {
              margin: 0;
              color: #111827;
            }

            .summary-card {
              display: block;
            }

            .summary-card > div {
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 16px;
              margin-bottom: 12px;
              font-size: 14px;
              color: #475569;
            }

            .summary-card > div:last-child {
              margin-bottom: 0;
            }

            .summary-card strong {
              color: #111827;
            }

            .summary-card .discount {
              color: #059669;
            }

            .summary-total {
              border-top: 2px solid #e2e8f0;
              padding-top: 12px;
            }

            .table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 18px;
            }

            .table th,
            .table td {
              padding: 14px 12px;
              border-bottom: 1px solid #e2e8f0;
              text-align: left;
              vertical-align: top;
            }

            .table th {
              font-size: 13px;
              letter-spacing: 0.03em;
              text-transform: uppercase;
              color: #667085;
            }

            .table td {
              color: #475569;
            }

            .variant-name {
              margin-top: 2px;
              font-size: 12px;
              color: #94a3b8;
            }

            .footer {
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #e2e8f0;
              font-size: 12px;
              color: #94a3b8;
              text-align: center;
            }

            @media only screen and (max-width: 600px) {
              body {
                padding: 12px 8px;
              }

              .container {
                padding: 18px;
                border-radius: 14px;
              }

              .email-header h1 {
                font-size: 24px;
              }

              .table th,
              .table td {
                padding: 10px 6px;
                font-size: 13px;
              }

              .otp-box span {
                letter-spacing: 8px;
              }
            }
          </style>
        </head>

        <body>
          <div class="container">
            ${content}

            <div class="footer">
              NUTS E-Commerce — Secure shopping made simple.
            </div>
          </div>
        </body>
      </html>
    `;
  }
}
