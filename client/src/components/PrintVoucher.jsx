import { formatMWK } from '../utils/format.js';

// Printable voucher face: brand, value, code, QR, expiry, T&Cs.
// Renders inline on screen and formats for A4 via print CSS; readable on phones.
export default function PrintVoucher({ voucher, qrCode }) {
  return (
    <div className="print-sheet">
      <div className="print-voucher">
        <div className="print-brand">SHOPWISE</div>
        <div className="print-title">SHOPPING VOUCHER</div>
        <div className="print-value">{formatMWK(voucher.originalValue)}</div>
        <div className="print-code">{voucher.code}</div>
        {qrCode && <img className="print-qr" src={qrCode} alt={`QR code for voucher ${voucher.code}`} />}
        <div className="print-expiry">
          Valid until {new Date(voucher.expiryDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
        </div>
        <div className="print-terms">
          <strong>Terms and Conditions</strong>
          <ul>
            <li>Valid at participating Shopwise stores{voucher.validStores?.length ? ` (${voucher.validStores.map((s) => s.name).join(', ')})` : ''}.</li>
            <li>Redeemable in store only; present this voucher at the till.</li>
            <li>Partial redemptions allowed; the remaining balance stays on this voucher.</li>
            <li>Not redeemable for cash. Not replaceable if lost or stolen.</li>
            <li>Void after the expiry date. Shopwise reserves the right to refuse fraudulent vouchers.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
