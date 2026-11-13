import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// ── Shared Types ──────────────────────────────────────────

export interface EmailOrderItem {
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  variantOptions?: { name: string; value: string }[];
  productImage?: string;
}

export interface OrderConfirmationData {
  orderNumber: string;
  customerName: string;
  items: EmailOrderItem[];
  totalAmount: number;
  discountAmount: number;
  discountCode?: string;
  finalAmount: number;
  currency: string;
  shippingAddress: string;
}

export interface NewOrderForVendorData {
  vendorStoreName: string;
  orderNumber: string;
  customerName: string;
  items: EmailOrderItem[];
  totalAmount: number;
  currency: string;
  orderTotalForVendor: number;
}

export interface OrderShippedData {
  orderNumber: string;
  customerName: string;
  items: EmailOrderItem[];
  trackingNumber?: string;
  shippingAddress: string;
  currency: string;
}

export interface OrderDeliveredData {
  orderNumber: string;
  customerName: string;
  items: EmailOrderItem[];
  currency: string;
}

export interface OrderCancelledData {
  orderNumber: string;
  customerName: string;
  items: EmailOrderItem[];
  reason?: string;
  refundProcessed: boolean;
  currency: string;
}

export interface PaymentConfirmedData {
  orderNumber: string;
  customerName: string;
  items: EmailOrderItem[];
  amount: number;
  currency: string;
  paymentReference: string;
}

export interface PaymentFailedData {
  orderNumber: string;
  customerName: string;
  reason?: string;
}

export interface ReferralRewardData {
  referrerName: string;
  rewardAmount: number;
  currency: string;
}

export interface VendorPaymentConfirmedData {
  vendorStoreName: string;
  amount: number;
  currency: string;
  orderNumber: string;
}

export interface WeeklySummaryData {
  vendorStoreName: string;
  ordersCount: number;
  revenue: number;
  pendingBalance: number;
  settledBalance: number;
  bestSellingProducts: { name: string; quantity: number; revenue: number }[];
  weekStart: string;
  weekEnd: string;
  currency: string;
}

export interface AbandonedCartData {
  firstName: string | null;
  itemCount: number;
  totalAmount: number;
  currency: string;
  reminderType: 'first' | 'second';
}

export interface LowStockData {
  vendorStoreName: string;
  productName: string;
  currentStock: number;
  variantName?: string;
}

// ── Service ────────────────────────────────────────────────

@Injectable()
export class EmailTemplatesService {
  private readonly frontendUrl: string;

  constructor(@Optional() private readonly config?: ConfigService) {
    const origins =
      this.config?.get<string>('ALLOWED_ORIGINS') ||
      process.env.ALLOWED_ORIGINS ||
      '';
    const primaryOrigin = origins.split(',')[0]?.trim();
    this.frontendUrl = primaryOrigin ? primaryOrigin.replace(/\/+$/, '') : '';
  }

  // ── Helpers ────────────────────────────────────────────

  private formatPrice(currency: string, amount: number): string {
    return `${currency.toUpperCase()} ${amount.toFixed(2)}`;
  }

  private renderItemsTable(items: EmailOrderItem[], currency: string): string {
    if (!items.length) return '';

    const rows = items
      .map(
        (item) => `
      <tr>
        <td style="padding:12px;border-bottom:1px solid #e2e8f0;color:#475569">
          <div style="font-weight:600;color:#111827">${this.escapeHtml(item.productName)}</div>
          ${
            item.variantOptions && item.variantOptions.length > 0
              ? item.variantOptions
                  .map(
                    (opt) =>
                      `<div style="font-size:12px;color:#94a3b8;margin-top:2px">${this.escapeHtml(opt.name)}: ${this.escapeHtml(opt.value)}</div>`,
                  )
                  .join('')
              : ''
          }
        </td>
        <td style="padding:12px;border-bottom:1px solid #e2e8f0;color:#475569;text-align:center">${item.quantity}</td>
        <td style="padding:12px;border-bottom:1px solid #e2e8f0;color:#475569;text-align:right">${this.formatPrice(currency, item.unitPrice)}</td>
        <td style="padding:12px;border-bottom:1px solid #e2e8f0;color:#111827;text-align:right;font-weight:600">${this.formatPrice(currency, item.totalPrice)}</td>
      </tr>`,
      )
      .join('');

    return `
          <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:15px">
            <thead>
              <tr style="background:#f8fafc">
                <th style="padding:12px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#667085;font-weight:600">Product</th>
                <th style="padding:12px;text-align:center;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#667085;font-weight:600">Qty</th>
                <th style="padding:12px;text-align:right;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#667085;font-weight:600">Unit Price</th>
                <th style="padding:12px;text-align:right;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#667085;font-weight:600">Total</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ── Order Confirmation (Customer) ──────────────────────

  orderConfirmation(data: OrderConfirmationData): string {
    const itemsHtml = this.renderItemsTable(data.items, data.currency);

    return this.baseHtml(`
      <div style="text-align:center;padding-bottom:28px;border-bottom:2px solid #e2e8f0">
        <div style="display:inline-block;background:#f5f3ff;border-radius:50%;width:64px;height:64px;line-height:64px;margin-bottom:16px">
          <span style="font-size:28px">&#10003;</span>
        </div>
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:1.5px;color:#7c3aed;text-transform:uppercase;font-weight:600">Order confirmation</p>
        <h1 style="margin:0;font-size:28px;color:#111827;font-weight:800">Order Confirmed!</h1>
      </div>

      <div style="padding-top:24px;color:#475569;line-height:1.7;font-size:15px">
        <p style="margin:0 0 4px">Hello <strong style="color:#111827">${data.customerName}</strong>,</p>
        <p style="margin:0 0 24px">Your order <strong style="color:#111827">#${data.orderNumber}</strong> has been placed successfully. We'll notify you once it ships.</p>

        <!-- Shipping Address -->
        <div style="background:#f8fafc;border-radius:12px;padding:16px 20px;margin-bottom:20px">
          <p style="margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#667085;font-weight:600">Shipping to</p>
          <p style="margin:0;color:#111827;font-size:15px">${data.shippingAddress}</p>
        </div>

        ${itemsHtml}

        <!-- Summary -->
        <div style="background:#f8fafc;border-radius:12px;padding:20px;margin-top:20px">
          <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:15px">
            <span style="color:#667085">Subtotal</span>
            <span style="color:#111827;font-weight:600">${this.formatPrice(data.currency, data.totalAmount)}</span>
          </div>
          ${
            data.discountAmount > 0
              ? `
          <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:15px;border-top:1px solid #e2e8f0">
            <span style="color:#667085">Discount${data.discountCode ? ` <span style="color:#7c3aed;font-weight:600">${data.discountCode}</span>` : ''}</span>
            <span style="color:#059669;font-weight:600">-${this.formatPrice(data.currency, data.discountAmount)}</span>
          </div>`
              : ''
          }
          <div style="display:flex;justify-content:space-between;padding:10px 0 0;margin-top:6px;border-top:2px solid #e2e8f0;font-size:18px">
            <span style="color:#111827;font-weight:700">Total Paid</span>
            <span style="color:#7c3aed;font-weight:800">${this.formatPrice(data.currency, data.finalAmount)}</span>
          </div>
        </div>

        <p style="margin-top:24px;text-align:center;font-size:14px;color:#94a3b8">Need help? <a href="mailto:support@nuts.com" style="color:#7c3aed;text-decoration:none;font-weight:600">Contact Support</a></p>
      </div>
    `);
  }

  // ── New Order for Vendor ──────────────────────────────

  newOrderForVendor(data: NewOrderForVendorData): string {
    const itemsHtml = this.renderItemsTable(data.items, data.currency);

    return this.baseHtml(`
      <div style="text-align:center;padding-bottom:28px;border-bottom:2px solid #e2e8f0">
        <div style="display:inline-block;background:#f5f3ff;border-radius:50%;width:64px;height:64px;line-height:64px;margin-bottom:16px">
          <span style="font-size:28px">&#127881;</span>
        </div>
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:1.5px;color:#7c3aed;text-transform:uppercase;font-weight:600">New sale</p>
        <h1 style="margin:0;font-size:28px;color:#111827;font-weight:800">New Order Received!</h1>
      </div>

      <div style="padding-top:24px;color:#475569;line-height:1.7;font-size:15px">
        <p style="margin:0 0 4px">Hello <strong style="color:#111827">${data.vendorStoreName}</strong>,</p>
        <p style="margin:0 0 24px">A new order <strong style="color:#111827">#${data.orderNumber}</strong> has been placed by <strong style="color:#111827">${data.customerName}</strong>.</p>

        ${itemsHtml}

        <!-- Vendor Earnings -->
        <div style="background:#f5f3ff;border-radius:12px;padding:20px;margin-top:20px;text-align:center">
          <p style="margin:0 0 4px;font-size:13px;color:#667085">Your earnings from this order</p>
          <p style="margin:0;font-size:28px;font-weight:800;color:#7c3aed">${this.formatPrice(data.currency, data.orderTotalForVendor)}</p>
        </div>

        <p style="margin-top:24px;text-align:center;font-size:14px;color:#94a3b8">We'll credit your wallet once the order is fulfilled.</p>
      </div>
    `);
  }

  // ── Order Shipped (Customer) ───────────────────────────

  orderShipped(data: OrderShippedData): string {
    const itemsHtml = this.renderItemsTable(data.items, data.currency);

    return this.baseHtml(`
      <div style="text-align:center;padding-bottom:28px;border-bottom:2px solid #e2e8f0">
        <div style="display:inline-block;background:#f5f3ff;border-radius:50%;width:64px;height:64px;line-height:64px;margin-bottom:16px">
          <span style="font-size:28px">&#128666;</span>
        </div>
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:1.5px;color:#7c3aed;text-transform:uppercase;font-weight:600">Shipping update</p>
        <h1 style="margin:0;font-size:28px;color:#111827;font-weight:800">Your Order Has Shipped!</h1>
      </div>

      <div style="padding-top:24px;color:#475569;line-height:1.7;font-size:15px">
        <p style="margin:0 0 4px">Hello <strong style="color:#111827">${data.customerName}</strong>,</p>
        <p style="margin:0 0 24px">Great news! Your order <strong style="color:#111827">#${data.orderNumber}</strong> is on its way.</p>

        ${itemsHtml}

        ${
          data.trackingNumber
            ? `
        <!-- Tracking Number -->
        <div style="background:#f8fafc;border:2px dashed #e2e8f0;border-radius:12px;padding:20px;margin-top:20px;text-align:center">
          <p style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#667085;font-weight:600">Tracking Number</p>
          <p style="margin:0 0 4px;font-size:22px;font-weight:800;color:#111827;letter-spacing:1px">${data.trackingNumber}</p>
          <p style="margin:0;font-size:13px;color:#94a3b8">Use this number to track your package</p>
        </div>`
            : ''
        }

        <!-- Shipping Address -->
        <div style="background:#f8fafc;border-radius:12px;padding:16px 20px;margin-top:20px">
          <p style="margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#667085;font-weight:600">Shipping to</p>
          <p style="margin:0;color:#111827;font-size:15px">${data.shippingAddress}</p>
        </div>

        <p style="margin-top:24px;text-align:center;font-size:14px;color:#94a3b8">We'll notify you when your order is delivered.</p>
      </div>
    `);
  }

  // ── Order Delivered (Customer) ─────────────────────────

  orderDelivered(data: OrderDeliveredData): string {
    const itemsHtml = this.renderItemsTable(data.items, data.currency);

    return this.baseHtml(`
      <div style="text-align:center;padding-bottom:28px;border-bottom:2px solid #e2e8f0">
        <div style="display:inline-block;background:#ecfdf5;border-radius:50%;width:64px;height:64px;line-height:64px;margin-bottom:16px">
          <span style="font-size:28px">&#127873;</span>
        </div>
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:1.5px;color:#059669;text-transform:uppercase;font-weight:600">Delivery confirmed</p>
        <h1 style="margin:0;font-size:28px;color:#111827;font-weight:800">Order Delivered!</h1>
      </div>

      <div style="padding-top:24px;color:#475569;line-height:1.7;font-size:15px">
        <p style="margin:0 0 4px">Hello <strong style="color:#111827">${data.customerName}</strong>,</p>
        <p style="margin:0 0 24px">Your order <strong style="color:#111827">#${data.orderNumber}</strong> has been delivered. We hope you love your purchase!</p>

        ${itemsHtml}

        <!-- Review Prompt -->
        <div style="background:#ecfdf5;border-radius:12px;padding:24px 20px;margin-top:20px;text-align:center">
          <p style="margin:0 0 12px;font-size:16px;color:#065f46;font-weight:600">Love what you got?</p>
          <p style="margin:0 0 16px;font-size:14px;color:#047857">Share your experience and help other shoppers make the right choice.</p>
          <a href="${this.getReviewUrl(data.orderNumber)}" style="display:inline-block;background:#059669;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Write a Review</a>
        </div>

        <p style="margin-top:24px;text-align:center;font-size:14px;color:#94a3b8">Thank you for shopping with us! ❤️</p>
      </div>
    `);
  }

  // ── Order Cancelled (Customer) ─────────────────────────

  orderCancelled(data: OrderCancelledData): string {
    const itemsHtml = this.renderItemsTable(data.items, data.currency);

    return this.baseHtml(`
      <div style="text-align:center;padding-bottom:28px;border-bottom:2px solid #e2e8f0">
        <div style="display:inline-block;background:#fef2f2;border-radius:50%;width:64px;height:64px;line-height:64px;margin-bottom:16px">
          <span style="font-size:28px">&#128683;</span>
        </div>
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:1.5px;color:#dc2626;text-transform:uppercase;font-weight:600">Order cancelled</p>
        <h1 style="margin:0;font-size:28px;color:#111827;font-weight:800">Order Cancelled</h1>
      </div>

      <div style="padding-top:24px;color:#475569;line-height:1.7;font-size:15px">
        <p style="margin:0 0 4px">Hello <strong style="color:#111827">${data.customerName}</strong>,</p>
        <p style="margin:0 0 24px">Your order <strong style="color:#111827">#${data.orderNumber}</strong> has been cancelled.</p>

        ${itemsHtml}

        ${
          data.reason
            ? `
        <!-- Reason -->
        <div style="background:#f8fafc;border-radius:12px;padding:16px 20px;margin-top:20px">
          <p style="margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#667085;font-weight:600">Reason</p>
          <p style="margin:0;color:#111827;font-size:15px">${data.reason}</p>
        </div>`
            : ''
        }

        ${
          data.refundProcessed
            ? `
        <!-- Refund Status -->
        <div style="background:#ecfdf5;border-radius:12px;padding:20px;margin-top:20px;text-align:center">
          <p style="margin:0 0 4px;font-size:28px">&#128179;</p>
          <p style="margin:0;font-size:15px;color:#065f46;font-weight:600">Refund Processed</p>
          <p style="margin:6px 0 0;font-size:14px;color:#047857">Your refund has been initiated and will reflect in your account within 3–5 business days.</p>
        </div>`
            : `
        <!-- No Refund -->
        <div style="background:#f8fafc;border-radius:12px;padding:16px 20px;margin-top:20px">
          <p style="margin:0;font-size:14px;color:#667085">No refund was processed for this cancellation. If you have any questions, please contact support.</p>
        </div>`
        }

        <p style="margin-top:24px;text-align:center;font-size:14px;color:#94a3b8">Questions? <a href="mailto:support@nuts.com" style="color:#7c3aed;text-decoration:none;font-weight:600">Contact Support</a></p>
      </div>
    `);
  }

  // ── Payment Confirmed (Customer) ───────────────────────

  paymentConfirmed(data: PaymentConfirmedData): string {
    const itemsHtml = this.renderItemsTable(data.items, data.currency);

    return this.baseHtml(`
      <div style="text-align:center;padding-bottom:28px;border-bottom:2px solid #e2e8f0">
        <div style="display:inline-block;background:#ecfdf5;border-radius:50%;width:64px;height:64px;line-height:64px;margin-bottom:16px">
          <span style="font-size:28px">&#10003;</span>
        </div>
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:1.5px;color:#059669;text-transform:uppercase;font-weight:600">Payment confirmed</p>
        <h1 style="margin:0;font-size:28px;color:#111827;font-weight:800">Payment Confirmed!</h1>
      </div>

      <div style="padding-top:24px;color:#475569;line-height:1.7;font-size:15px">
        <p style="margin:0 0 4px">Hello <strong style="color:#111827">${data.customerName}</strong>,</p>
        <p style="margin:0 0 24px">Your payment for order <strong style="color:#111827">#${data.orderNumber}</strong> has been successfully confirmed.</p>

        <!-- Amount Paid -->
        <div style="background:#ecfdf5;border-radius:12px;padding:20px;margin-bottom:20px;text-align:center">
          <p style="margin:0 0 4px;font-size:13px;color:#667085">Amount Paid</p>
          <p style="margin:0;font-size:32px;font-weight:800;color:#059669">${this.formatPrice(data.currency, data.amount)}</p>
        </div>

        ${itemsHtml}

        <!-- Payment Reference -->
        <div style="background:#f8fafc;border-radius:12px;padding:16px 20px;margin-top:20px">
          <p style="margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#667085;font-weight:600">Payment Reference</p>
          <p style="margin:0;color:#111827;font-size:15px;font-family:monospace">${data.paymentReference}</p>
        </div>

        <p style="margin-top:24px;text-align:center;font-size:14px;color:#94a3b8">A receipt has been sent to your registered email address.</p>
      </div>
    `);
  }

  // ── Payment Failed (Customer) ──────────────────────────

  paymentFailed(data: PaymentFailedData): string {
    return this.baseHtml(`
      <div style="text-align:center;padding-bottom:28px;border-bottom:2px solid #e2e8f0">
        <div style="display:inline-block;background:#fef2f2;border-radius:50%;width:64px;height:64px;line-height:64px;margin-bottom:16px">
          <span style="font-size:28px">&#9888;</span>
        </div>
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:1.5px;color:#dc2626;text-transform:uppercase;font-weight:600">Payment failed</p>
        <h1 style="margin:0;font-size:28px;color:#111827;font-weight:800">Payment Unsuccessful</h1>
      </div>

      <div style="padding-top:24px;color:#475569;line-height:1.7;font-size:15px">
        <p style="margin:0 0 4px">Hello <strong style="color:#111827">${data.customerName}</strong>,</p>
        <p style="margin:0 0 24px">The payment for order <strong style="color:#111827">#${data.orderNumber}</strong> could not be processed.</p>

        ${
          data.reason
            ? `
        <div style="background:#fef2f2;border-radius:12px;padding:16px 20px;margin-bottom:20px">
          <p style="margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#dc2626;font-weight:600">Reason</p>
          <p style="margin:0;color:#111827;font-size:15px">${data.reason}</p>
        </div>`
            : ''
        }

        <div style="background:#f8fafc;border-radius:12px;padding:20px;margin-bottom:20px">
          <p style="margin:0 0 12px;font-size:15px;color:#111827;font-weight:600">What to do next</p>
          <ol style="margin:0;padding-left:20px;color:#475569;line-height:2">
            <li>Check your payment details and try again</li>
            <li>Use a different payment method</li>
            <li>Ensure you have sufficient funds in your account</li>
          </ol>
        </div>

        <p style="text-align:center;font-size:14px;color:#94a3b8">Need assistance? <a href="mailto:support@nuts.com" style="color:#7c3aed;text-decoration:none;font-weight:600">Contact Support</a></p>
      </div>
    `);
  }

  // ── Referral Reward Credited ───────────────────────────

  referralRewardCredited(data: ReferralRewardData): string {
    return this.baseHtml(`
      <div style="text-align:center;padding-bottom:28px;border-bottom:2px solid #e2e8f0">
        <div style="display:inline-block;background:#f5f3ff;border-radius:50%;width:64px;height:64px;line-height:64px;margin-bottom:16px">
          <span style="font-size:28px">&#127942;</span>
        </div>
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:1.5px;color:#7c3aed;text-transform:uppercase;font-weight:600">Reward earned</p>
        <h1 style="margin:0;font-size:28px;color:#111827;font-weight:800">Referral Reward Earned!</h1>
      </div>

      <div style="padding-top:24px;color:#475569;line-height:1.7;font-size:15px;text-align:center">
        <p style="margin:0 0 4px">Hello <strong style="color:#111827">${data.referrerName}</strong>,</p>
        <p style="margin:0 0 24px">Someone you referred just made a purchase. You've earned a reward!</p>

        <div style="background:#f5f3ff;border-radius:16px;padding:28px 20px;margin-bottom:20px">
          <p style="margin:0 0 6px;font-size:14px;color:#667085">Reward Amount</p>
          <p style="margin:0 0 4px;font-size:36px;font-weight:800;color:#7c3aed">${this.formatPrice(data.currency, data.rewardAmount)}</p>
          <p style="margin:0;font-size:14px;color:#6b21a8">has been credited to your wallet</p>
        </div>

        <p style="font-size:15px;color:#475569">Keep sharing your referral link to earn more rewards!</p>
      </div>
    `);
  }

  // ── Vendor Payment Confirmed ──────────────────────────

  vendorPaymentConfirmed(data: VendorPaymentConfirmedData): string {
    return this.baseHtml(`
      <div style="text-align:center;padding-bottom:28px;border-bottom:2px solid #e2e8f0">
        <div style="display:inline-block;background:#ecfdf5;border-radius:50%;width:64px;height:64px;line-height:64px;margin-bottom:16px">
          <span style="font-size:28px">&#128176;</span>
        </div>
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:1.5px;color:#059669;text-transform:uppercase;font-weight:600">Earnings credited</p>
        <h1 style="margin:0;font-size:28px;color:#111827;font-weight:800">Earnings Credited!</h1>
      </div>

      <div style="padding-top:24px;color:#475569;line-height:1.7;font-size:15px">
        <p style="margin:0 0 4px">Hello <strong style="color:#111827">${data.vendorStoreName}</strong>,</p>
        <p style="margin:0 0 24px">Your earnings from order <strong style="color:#111827">#${data.orderNumber}</strong> have been credited.</p>

        <div style="background:#ecfdf5;border-radius:16px;padding:28px 20px;margin-bottom:20px;text-align:center">
          <p style="margin:0 0 6px;font-size:14px;color:#667085">Amount Credited</p>
          <p style="margin:0;font-size:36px;font-weight:800;color:#059669">${this.formatPrice(data.currency, data.amount)}</p>
        </div>

        <p style="text-align:center;font-size:15px;color:#475569">Your wallet balance has been updated. Keep creating amazing products!</p>

        <p style="margin-top:24px;text-align:center;font-size:14px;color:#94a3b8">Questions about your payout? <a href="mailto:support@nuts.com" style="color:#7c3aed;text-decoration:none;font-weight:600">Contact Support</a></p>
      </div>
    `);
  }

  // ── Weekly Vendor Summary ─────────────────────────────

  weeklyVendorSummary(data: WeeklySummaryData): string {
    const productsHtml = data.bestSellingProducts
      .map(
        (p) => `
            <tr>
              <td style="padding:12px;border-bottom:1px solid #e2e8f0;color:#111827;font-weight:500;font-size:14px">${this.escapeHtml(p.name)}</td>
              <td style="padding:12px;border-bottom:1px solid #e2e8f0;color:#475569;text-align:center;font-size:14px">${p.quantity}</td>
              <td style="padding:12px;border-bottom:1px solid #e2e8f0;color:#111827;text-align:right;font-size:14px;font-weight:600">${this.formatPrice(data.currency, p.revenue)}</td>
            </tr>`,
      )
      .join('');

    return this.baseHtml(`
      <div style="text-align:center;padding-bottom:28px;border-bottom:2px solid #e2e8f0">
        <div style="display:inline-block;background:#f5f3ff;border-radius:50%;width:64px;height:64px;line-height:64px;margin-bottom:16px">
          <span style="font-size:28px">&#128202;</span>
        </div>
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:1.5px;color:#7c3aed;text-transform:uppercase;font-weight:600">Weekly summary</p>
        <h1 style="margin:0;font-size:28px;color:#111827;font-weight:800">Your Weekly Earnings Report</h1>
        <p style="margin:8px 0 0;font-size:14px;color:#667085">${data.weekStart} — ${data.weekEnd}</p>
      </div>

      <div style="padding-top:24px;color:#475569;line-height:1.7;font-size:15px">
        <p style="margin:0 0 4px">Hello <strong style="color:#111827">${data.vendorStoreName}</strong>,</p>
        <p style="margin:0 0 24px">Here's your performance summary for this week.</p>

        <!-- KPI Cards -->
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
          <tr>
            <td style="width:50%;padding:8px">
              <div style="background:#f8fafc;border-radius:12px;padding:16px;text-align:center">
                <p style="margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#667085;font-weight:600">Orders</p>
                <p style="margin:0;font-size:24px;font-weight:800;color:#111827">${data.ordersCount}</p>
              </div>
            </td>
            <td style="width:50%;padding:8px">
              <div style="background:#f8fafc;border-radius:12px;padding:16px;text-align:center">
                <p style="margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#667085;font-weight:600">Revenue</p>
                <p style="margin:0;font-size:24px;font-weight:800;color:#059669">${this.formatPrice(data.currency, data.revenue)}</p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="width:50%;padding:8px">
              <div style="background:#f8fafc;border-radius:12px;padding:16px;text-align:center">
                <p style="margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#667085;font-weight:600">Pending</p>
                <p style="margin:0;font-size:24px;font-weight:800;color:#d97706">${this.formatPrice(data.currency, data.pendingBalance)}</p>
              </div>
            </td>
            <td style="width:50%;padding:8px">
              <div style="background:#f8fafc;border-radius:12px;padding:16px;text-align:center">
                <p style="margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#667085;font-weight:600">Settled</p>
                <p style="margin:0;font-size:24px;font-weight:800;color:#7c3aed">${this.formatPrice(data.currency, data.settledBalance)}</p>
              </div>
            </td>
          </tr>
        </table>

        ${
          data.bestSellingProducts.length
            ? `
        <h3 style="color:#111827;font-size:16px;margin:0 0 12px;font-weight:700">Best Selling Products</h3>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead>
            <tr style="background:#f8fafc">
              <th style="padding:12px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#667085;font-weight:600">Product</th>
              <th style="padding:12px;text-align:center;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#667085;font-weight:600">Sold</th>
              <th style="padding:12px;text-align:right;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#667085;font-weight:600">Revenue</th>
            </tr>
          </thead>
          <tbody>${productsHtml}</tbody>
        </table>`
            : `<p style="text-align:center;color:#94a3b8;padding:20px">No sales this week. Keep promoting your products!</p>`
        }

        <p style="margin-top:24px;text-align:center;font-size:14px;color:#94a3b8">Keep up the great work! 🚀</p>
      </div>
    `);
  }

  // ── Abandoned Cart Reminder ────────────────────────────

  abandonedCartReminder(data: AbandonedCartData): string {
    const greeting = data.firstName
      ? `Hello <strong style="color:#111827">${data.firstName}</strong>`
      : 'Hello';
    const message =
      data.reminderType === 'first'
        ? "You left some items in your cart. They're still waiting for you!"
        : 'Your cart is about to expire! Complete your purchase before the items are gone.';

    return this.baseHtml(`
      <div style="text-align:center;padding-bottom:28px;border-bottom:2px solid #e2e8f0">
        <div style="display:inline-block;background:#f5f3ff;border-radius:50%;width:64px;height:64px;line-height:64px;margin-bottom:16px">
          <span style="font-size:28px">&#128722;</span>
        </div>
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:1.5px;color:#7c3aed;text-transform:uppercase;font-weight:600">Cart reminder</p>
        <h1 style="margin:0;font-size:28px;color:#111827;font-weight:800">You Left Something Behind!</h1>
      </div>

      <div style="padding-top:24px;color:#475569;line-height:1.7;font-size:15px;text-align:center">
        <p style="margin:0 0 12px">${greeting},</p>
        <p style="margin:0 0 24px">${message}</p>

        <div style="background:#f8fafc;border-radius:16px;padding:24px 20px;margin-bottom:24px">
          <p style="margin:0 0 8px;font-size:14px;color:#667085">Items in your cart</p>
          <p style="margin:0 0 4px;font-size:14px;color:#111827;font-weight:600">${data.itemCount} item${data.itemCount > 1 ? 's' : ''}</p>
          <p style="margin:0;font-size:28px;font-weight:800;color:#7c3aed">${this.formatPrice(data.currency, data.totalAmount)}</p>
        </div>

        <a href="${this.getCartUrl()}" style="display:inline-block;background:#7c3aed;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px">Complete Your Purchase</a>

        <p style="margin-top:24px;font-size:14px;color:#94a3b8">Your cart items are reserved for a limited time. Don't miss out!</p>
      </div>
    `);
  }

  // ── Low Stock Alert ────────────────────────────────────

  lowStockAlert(data: LowStockData): string {
    const itemName = data.variantName
      ? `${data.productName} — ${data.variantName}`
      : data.productName;

    return this.baseHtml(`
      <div style="text-align:center;padding-bottom:28px;border-bottom:2px solid #e2e8f0">
        <div style="display:inline-block;background:#fef2f2;border-radius:50%;width:64px;height:64px;line-height:64px;margin-bottom:16px">
          <span style="font-size:28px">&#128680;</span>
        </div>
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:1.5px;color:#dc2626;text-transform:uppercase;font-weight:600">Low stock alert</p>
        <h1 style="margin:0;font-size:28px;color:#111827;font-weight:800">Stock Running Low!</h1>
      </div>

      <div style="padding-top:24px;color:#475569;line-height:1.7;font-size:15px">
        <p style="margin:0 0 4px">Hello <strong style="color:#111827">${data.vendorStoreName}</strong>,</p>
        <p style="margin:0 0 24px">Your product <strong style="color:#111827">${this.escapeHtml(itemName)}</strong> is running low on stock.</p>

        <div style="background:#fef2f2;border:2px solid #fecaca;border-radius:16px;padding:24px 20px;margin-bottom:20px;text-align:center">
          <p style="margin:0 0 6px;font-size:13px;color:#991b1b;font-weight:600">Current Stock Level</p>
          <p style="margin:0;font-size:40px;font-weight:800;color:#dc2626">${data.currentStock}</p>
          <p style="margin:8px 0 0;font-size:14px;color:#b91c1c">${data.currentStock <= 0 ? 'Out of stock — orders may be affected' : data.currentStock <= 5 ? 'Critically low — restock immediately' : 'Running low — plan your next restock'}</p>
        </div>

        <p style="text-align:center;font-size:15px;color:#475569">Restock soon to avoid missing out on sales and keep your customers happy.</p>

        <p style="margin-top:24px;text-align:center;font-size:14px;color:#94a3b8">Need help managing inventory? <a href="mailto:support@nuts.com" style="color:#7c3aed;text-decoration:none;font-weight:600">Contact Support</a></p>
      </div>
    `);
  }

  // ── Base Wrapper ───────────────────────────────────────

  private baseHtml(content: string): string {
    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
  .container{width:100%;max-width:600px;margin:0 auto;padding:32px 28px;background:#fff;border-radius:20px;box-shadow:0 24px 60px rgba(15,23,42,0.08);box-sizing:border-box}
  .footer{margin-top:32px;padding-top:20px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;text-align:center;line-height:1.8}
  @media only screen and (max-width:480px){.container{padding:20px 16px!important}h1{font-size:24px!important}}
</style></head>
<body>
  <div class="container">
    ${content}
    <div class="footer">
      <p style="margin:0">NUTS E-Commerce — Secure shopping made simple.</p>
      <p style="margin:4px 0 0">If you have any questions, reply to this email or contact <a href="mailto:support@nuts.com" style="color:#7c3aed;text-decoration:none">support@nuts.com</a></p>
    </div>
  </div>
</body>
</html>`;
  }

  // ── URL Helpers ──────────────────────────────────────────

  private getReviewUrl(orderNumber: string): string {
    return `${this.frontendUrl}/orders/${orderNumber}/review`;
  }

  private getCartUrl(): string {
    return `${this.frontendUrl}/cart`;
  }

  private getOrderUrl(orderNumber: string): string {
    return `${this.frontendUrl}/order/${orderNumber}`;
  }

  private getVendorDashboardUrl(): string {
    return `${this.frontendUrl}/vendor/order`;
  }
}
