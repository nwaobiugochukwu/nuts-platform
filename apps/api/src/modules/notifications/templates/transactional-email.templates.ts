/**
 * Transactional Email Templates (HTML/MJML format)
 * 360° Notification Matrix
 */

export interface OrderConfirmationEmailData {
  orderNumber: string;
  customerName: string;
  totalAmount: number;
  items: Array<{ name: string; quantity: number; price: number }>;
  viewOrderUrl: string;
}

export interface SecurityAlertEmailData {
  userName: string;
  action: string;
  ipAddress?: string;
  userAgent?: string;
  timestamp: string;
  actionUrl: string;
}

export interface VendorPayoutEmailData {
  vendorName: string;
  storeName: string;
  amount: number;
  reference: string;
  walletBalance: number;
  dashboardUrl: string;
}

export function buildOrderConfirmationHtml(
  data: OrderConfirmationEmailData,
): string {
  const itemRows = data.items
    .map(
      (item) => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${item.name}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.quantity}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: right;">₦${item.price.toLocaleString()}</td>
      </tr>
    `,
    )
    .join('');

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #111827; background-color: #f9fafb; margin: 0; padding: 24px; }
          .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb; overflow: hidden; padding: 32px; }
          .header { text-align: center; border-bottom: 2px solid #f3f4f6; padding-bottom: 24px; margin-bottom: 24px; }
          .button { display: inline-block; padding: 12px 24px; background-color: #4f46e5; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; margin-top: 24px; }
          .table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="header">
            <h1 style="margin: 0; color: #4f46e5; font-size: 24px;">Order Confirmed!</h1>
            <p style="margin: 8px 0 0; color: #6b7280;">Order #${data.orderNumber}</p>
          </div>
          <p>Hi ${data.customerName},</p>
          <p>Thank you for shopping with us! Your order has been placed and is now being processed.</p>
          <table class="table">
            <thead>
              <tr style="background: #f9fafb; text-align: left; font-size: 14px; color: #4b5563;">
                <th style="padding: 8px;">Item</th>
                <th style="padding: 8px; text-align: center;">Qty</th>
                <th style="padding: 8px; text-align: right;">Price</th>
              </tr>
            </thead>
            <tbody>
              ${itemRows}
            </tbody>
          </table>
          <div style="text-align: right; margin-top: 16px; font-size: 18px; font-weight: bold;">
            Total: ₦${data.totalAmount.toLocaleString()}
          </div>
          <div style="text-align: center;">
            <a href="${data.viewOrderUrl}" class="button">View Order Details</a>
          </div>
        </div>
      </body>
    </html>
  `;
}

export function buildSecurityAlertHtml(data: SecurityAlertEmailData): string {
  return `
    <!DOCTYPE html>
    <html>
      <body style="font-family: sans-serif; background: #f9fafb; padding: 24px;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 24px; border: 1px solid #fee2e2;">
          <h2 style="color: #dc2626; margin-top: 0;">Security Alert: ${data.action}</h2>
          <p>Hello ${data.userName},</p>
          <p>A recent security event was detected on your account:</p>
          <ul>
            <li><strong>Action:</strong> ${data.action}</li>
            <li><strong>Timestamp:</strong> ${data.timestamp}</li>
            ${data.ipAddress ? `<li><strong>IP Address:</strong> ${data.ipAddress}</li>` : ''}
            ${data.userAgent ? `<li><strong>Browser/Device:</strong> ${data.userAgent}</li>` : ''}
          </ul>
          <p>If you did not authorize this action, please secure your account immediately.</p>
          <a href="${data.actionUrl}" style="display: inline-block; padding: 10px 20px; background: #dc2626; color: white; text-decoration: none; border-radius: 6px;">Secure Account</a>
        </div>
      </body>
    </html>
  `;
}
