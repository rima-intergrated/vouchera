import { useEffect, useState } from 'react';
import api from '../services/api.js';
import { formatMWK } from '../utils/format.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDate(d) {
  try {
    return new Date(d).toLocaleString('en-GB');
  } catch {
    return '';
  }
}

// Standalone receipt document — identical for preview, print and download.
export function buildReceiptHtml(r) {
  const lines = (r.lines || []).map((l) => `
      <tr><td>${esc(l.label)}</td><td class="amt">${esc(formatMWK(l.amount))}</td></tr>`).join('');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Receipt ${esc(r.reference || r.id)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#111;max-width:420px;margin:0 auto;padding:24px}
  h1{font-size:20px;text-align:center;margin:0 0 2px}
  .sub{text-align:center;color:#555;font-size:12px;margin-bottom:16px}
  table{width:100%;border-collapse:collapse;margin:12px 0}
  td{padding:6px 4px;border-bottom:1px dashed #ccc;font-size:14px}
  .amt{text-align:right;white-space:nowrap}
  .total td{font-weight:bold;font-size:16px;border-bottom:2px solid #111}
  .meta{font-size:12px;color:#333}
  .meta div{margin:2px 0}
  .foot{text-align:center;font-size:11px;color:#777;margin-top:16px}
  @media print{body{padding:0}}
</style></head><body>
  <h1>SHOPWISE</h1>
  <div class="sub">${r.kind === 'TOP_UP' ? 'Wallet Credit Slip' : 'Payment Receipt'} · ${esc(r.reference || r.id)}</div>
  <table>${lines}
    <tr class="total"><td>Total</td><td class="amt">${esc(formatMWK(r.total))}</td></tr>
  </table>
  <div class="meta">
    <div>Date: ${esc(fmtDate(r.date))}</div>
    ${r.store ? `<div>Store: ${esc(r.store.name)}${r.store.code ? ` (${esc(r.store.code)})` : ''}</div>` : ''}
    ${r.cashier ? `<div>Served by: ${esc(r.cashier.name)}</div>` : ''}
    ${r.customer ? `<div>Customer: ${esc(r.customer.name)}</div>` : ''}
    ${r.code ? `<div>Code: ${esc(r.code)}</div>` : ''}
    ${r.posTransactionReference ? `<div>POS ref: ${esc(r.posTransactionReference)}</div>` : ''}
    ${r.previousBalance !== undefined && r.previousBalance !== null ? `<div>Balance: ${esc(formatMWK(r.previousBalance))} → ${esc(formatMWK(r.newBalance))}</div>` : ''}
    ${r.pointsUsed ? `<div>Points used: ${esc(r.pointsUsed)} (−${esc(formatMWK(r.pointsDiscount || 0))})</div>` : ''}
  </div>
  <div class="foot">Thank you for shopping with Shopwise · system-generated receipt</div>
</body></html>`;
}

// Clickable-history receipt: preview in a modal, Print via a print window,
// Download as a standalone .html file. `url` is the receipt API endpoint.
export default function ReceiptModal({ url, title, onClose }) {
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.get(url)
      .then(({ data }) => {
        if (!cancelled) setReceipt(data.receipt);
      })
      .catch((err) => {
        if (!cancelled) setError(err.response?.data?.error || 'Could not load receipt');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const html = receipt ? buildReceiptHtml(receipt) : '';

  const print = () => {
    if (!html) return;
    const w = window.open('', '_blank');
    if (!w) {
      download();
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  };

  const download = () => {
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `receipt-${receipt.reference || receipt.id}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{title || 'Receipt'}</h2>
          <button className="btn secondary" onClick={onClose} style={{ marginLeft: 'auto' }}>Close</button>
        </div>
        {loading && <p className="muted">Loading receipt…</p>}
        {error && <p className="error">{error}</p>}
        {receipt && (
          <>
            <iframe title="Receipt preview" srcDoc={html} style={{ width: '100%', height: 420, border: '1px solid #ddd', borderRadius: 8, background: '#fff' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="btn" onClick={print} style={{ flex: 1 }}>Print</button>
              <button className="btn secondary" onClick={download} style={{ flex: 1 }}>Download</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
