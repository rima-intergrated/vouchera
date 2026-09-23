import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api.js';
import ReceiptModal from '../components/ReceiptModal.jsx';
import { formatMWK } from '../utils/format.js';

export default function CashierHistory() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [receiptId, setReceiptId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get('/redemptions/mine?limit=50')
      .then(({ data }) => {
        if (!cancelled) setItems(data.items ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.response?.data?.error || 'Failed to load history');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="cashier-wrap">
      <h1>MY REDEMPTIONS</h1>
      {loading && <div className="card"><p className="muted">Loading…</p></div>}
      {!loading && error && <div className="card"><p className="error">{error}</p></div>}
      {!loading && !error && items.length === 0 && (
        <div className="card"><p className="muted">No redemptions yet.</p></div>
      )}
      {!loading && !error && items.map((r) => (
        <div className="card history-item clickable" key={r.id} onClick={() => setReceiptId(r.id)} title="Open receipt">
          <strong>{formatMWK(r.amountRedeemed)}</strong> · {r.voucherCode}
          <div className="muted small">
            {r.redemptionReference} · {r.store?.name ?? ''} · {r.posTransactionReference} ·{' '}
            {new Date(r.redeemedAt).toLocaleString('en-GB')}
          </div>
        </div>
      ))}
      {receiptId && (
        <ReceiptModal url={`/redemptions/${receiptId}/receipt`} title="Till Receipt" onClose={() => setReceiptId(null)} />
      )}
      <p style={{ textAlign: 'center' }}><Link to="/cashier">Back</Link></p>
    </div>
  );
}
