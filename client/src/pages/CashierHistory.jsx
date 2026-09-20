import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api.js';
import { formatMWK } from '../utils/format.js';

export default function CashierHistory() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
        <div className="card history-item" key={r.id}>
          <strong>{formatMWK(r.amountRedeemed)}</strong> · {r.voucherCode}
          <div className="muted small">
            {r.redemptionReference} · {r.store?.name ?? ''} · {r.posTransactionReference} ·{' '}
            {new Date(r.redeemedAt).toLocaleString('en-GB')}
          </div>
        </div>
      ))}
      <p style={{ textAlign: 'center' }}><Link to="/cashier">Back</Link></p>
    </div>
  );
}
