import * as fs from 'fs';
import PDFDocument from 'pdfkit';

export interface PdfInvoiceData {
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  shippingAddress: string;
  totalAmount: number;
  discountAmount: number;
  discountCode?: string | null;
  finalAmount: number;
  currency: string;
  createdAt: Date;
  items: Array<{
    productName: string;
    quantity: number;
    price: number;
    variantName?: string;
  }>;
}

export function generateInvoicePdf(
  data: PdfInvoiceData,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const writeStream = fs.createWriteStream(outputPath);

    doc.pipe(writeStream);

    // Title / Logo Area
    doc
      .fontSize(24)
      .fillColor('#4F46E5')
      .text('NUTS E-Commerce', { align: 'left' });
    doc
      .fontSize(10)
      .fillColor('#6B7280')
      .text('Premium Quality Products', { align: 'left' });
    doc.moveDown(2);

    doc
      .fontSize(18)
      .fillColor('#1F2937')
      .text('INVOICE / RECEIPT', { align: 'right' });
    doc.moveDown(1);

    // Metadata
    doc.fontSize(10).fillColor('#374151');
    doc.text(`Order Number: ${data.orderNumber}`, { align: 'left' });
    doc.text(`Order Date: ${data.createdAt.toLocaleDateString()}`, {
      align: 'left',
    });
    doc.moveDown();

    // Customer / Shipping Info
    doc.fontSize(12).fillColor('#1F2937').text('Bill To:', { underline: true });
    doc.fontSize(10).fillColor('#374151');
    doc.text(`Customer Name: ${data.customerName}`);
    doc.text(`Customer Email: ${data.customerEmail}`);
    doc.text(`Shipping Address: ${data.shippingAddress}`);
    doc.moveDown(2);

    // Line items table
    doc
      .fontSize(12)
      .fillColor('#1F2937')
      .text('Order Items:', { underline: true });
    doc.moveDown(0.5);

    // Draw header row
    doc.fontSize(10).fillColor('#4B5563');
    const tableTop = doc.y;
    doc.text('Item Description', 50, tableTop, { width: 250 });
    doc.text('Quantity', 300, tableTop, { width: 50, align: 'right' });
    doc.text('Unit Price', 380, tableTop, { width: 70, align: 'right' });
    doc.text('Total', 470, tableTop, { width: 70, align: 'right' });

    // Draw line under header
    doc
      .moveTo(50, tableTop + 15)
      .lineTo(540, tableTop + 15)
      .strokeColor('#E5E7EB')
      .stroke();
    doc.moveDown(1);

    let currentY = tableTop + 25;
    data.items.forEach((item) => {
      // Product name
      doc.fontSize(10).fillColor('#374151');
      doc.text(item.productName, 50, currentY, { width: 250 });

      // Variant info (smaller font, gray color)
      if (item.variantName) {
        doc.fontSize(8).fillColor('#9CA3AF');
        doc.text(item.variantName, 50, currentY + 11, { width: 250 });
      }

      const itemY = item.variantName ? currentY + 4 : currentY;

      doc.fontSize(10).fillColor('#374151');
      doc.text(item.quantity.toString(), 300, itemY, {
        width: 50,
        align: 'right',
      });
      doc.text(
        `${data.currency.toUpperCase()} ${item.price.toFixed(2)}`,
        380,
        itemY,
        { width: 70, align: 'right' },
      );
      doc.text(
        `${data.currency.toUpperCase()} ${(item.price * item.quantity).toFixed(2)}`,
        470,
        itemY,
        { width: 70, align: 'right' },
      );
      currentY += item.variantName ? 28 : 20;
    });

    // Draw totals section
    currentY += 20;

    // Subtotal
    doc.fontSize(10).fillColor('#374151');
    doc.text('Subtotal:', 350, currentY, { width: 100, align: 'left' });
    doc.text(
      `${data.currency.toUpperCase()} ${data.totalAmount.toFixed(2)}`,
      450,
      currentY,
      { width: 100, align: 'right' },
    );

    // Discount (if any)
    if (data.discountAmount > 0) {
      currentY += 18;
      doc.fontSize(10).fillColor('#059669');
      const discountLabel = data.discountCode
        ? `Discount (${data.discountCode}):`
        : 'Discount:';
      doc.text(discountLabel, 350, currentY, { width: 100, align: 'left' });
      doc.text(
        `-${data.currency.toUpperCase()} ${data.discountAmount.toFixed(2)}`,
        450,
        currentY,
        { width: 100, align: 'right' },
      );
    }

    currentY += 18;
    doc
      .moveTo(350, currentY - 4)
      .lineTo(540, currentY - 4)
      .strokeColor('#4F46E5')
      .stroke();

    doc
      .fontSize(12)
      .fillColor('#1F2937')
      .text('Total:', 350, currentY, { width: 100, align: 'left' });
    doc
      .fontSize(12)
      .fillColor('#1F2937')
      .text(
        `${data.currency.toUpperCase()} ${data.finalAmount.toFixed(2)}`,
        450,
        currentY,
        { width: 100, align: 'right' },
      );

    // Footer
    doc
      .fontSize(10)
      .fillColor('#9CA3AF')
      .text(
        'Thank you for your business! If you have any questions, please contact support.',
        50,
        700,
        { align: 'center', width: 500 },
      );

    doc.end();

    writeStream.on('finish', () => {
      resolve();
    });

    writeStream.on('error', (err) => {
      reject(err);
    });
  });
}
