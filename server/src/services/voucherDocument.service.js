import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

// Standalone voucher document (PDF): brand, value, code, QR, expiry, terms.
// QR encodes the voucher code ONLY — never value or customer data.
export function money(n) {
  return `K${Number(n).toLocaleString('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function buildVoucherPdf(voucher) {
  const qrPng = await QRCode.toBuffer(voucher.code, { width: 360, margin: 1 });
  const stores = (voucher.validStores ?? []).map((s) => s.name).filter(Boolean);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 60 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - 120;
    let y = 90;

    doc.fillColor('#0B2545').fontSize(34).font('Helvetica-Bold')
      .text('SHOPWISE', 60, y, { width: pageWidth, align: 'center' });
    y += 44;
    doc.fillColor('#5B6B82').fontSize(13).font('Helvetica')
      .text('S H O P P I N G   V O U C H E R', 60, y, { width: pageWidth, align: 'center' });
    y += 40;

    doc.fillColor('#2D6A4F').fontSize(46).font('Helvetica-Bold')
      .text(money(voucher.originalValue), 60, y, { width: pageWidth, align: 'center' });
    y += 60;

    doc.fillColor('#1A2332').fontSize(22).font('Helvetica-Bold')
      .text(voucher.code, 60, y, { width: pageWidth, align: 'center' });
    y += 36;

    const qrSize = 190;
    doc.image(qrPng, (doc.page.width - qrSize) / 2, y, { width: qrSize, height: qrSize });
    y += qrSize + 20;

    doc.fillColor('#1A2332').fontSize(13).font('Helvetica-Bold')
      .text(
        `Valid until ${new Date(voucher.expiryDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
        60, y, { width: pageWidth, align: 'center' }
      );
    y += 30;

    doc.fillColor('#1A2332').fontSize(12).font('Helvetica-Bold').text('Terms and Conditions', 60, y);
    y += 18;
    doc.fillColor('#5B6B82').fontSize(10).font('Helvetica');
    const terms = [
      `Valid at participating Shopwise stores${stores.length ? ` (${stores.join(', ')})` : ''}.`,
      'Redeemable in store only; present this voucher at the till.',
      'Partial redemptions allowed; the remaining balance stays on this voucher.',
      'Not redeemable for cash. Not replaceable if lost or stolen.',
      'Void after the expiry date. Shopwise reserves the right to refuse fraudulent vouchers.',
    ];
    for (const term of terms) {
      doc.text(`•  ${term}`, 70, y, { width: pageWidth - 20 });
      y = doc.y + 4;
    }

    doc.fillColor('#5B6B82').fontSize(9)
      .text(`Voucher ${voucher.code} • shopwise.mw`, 60, doc.page.height - 80, { width: pageWidth, align: 'center' });

    doc.end();
  });
}
