import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api.js';
import { formatMWK } from '../utils/format.js';

export default function PortalHistory() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/wallets/transactions?page=${page}&limit=20`);
      setData(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="cashier-wrap">
      <h1>MY ACTIVITY</h1>
      {loading && <div className="card"><p className="muted">Loading…</p></div>}
      {!loading && error && (
        <div className="card error-state">
          <p className="error">{error}</p>
          <button className="btn" onClick={load}>Retry</button>
        </div>
      )}
      {!loading && !error && data && (
        <>
          <div className="card balance-hero">
            <div className="muted">Current Balance</div>
            <div className="balance-value">{formatMWK(data.customer.walletBalance)}</div>
          </div>
          {data.items.length === 0 ? (
            <div className="card"><p className="muted">No transactions yet.</p></div>
          ) : (
            data.items.map((t) => (
              <div className="card history-item" key={t.id}>
                <strong>{t.type === 'TOP_UP' ? '+' : '−'}{formatMWK(t.amount)}</strong>{' '}
                {t.type === 'TOP_UP' ? `Top-up (${t.method}${t.paymentReference ? ` · ${t.paymentReference}` : ''})` : 'Purchase'}
                <div className="muted small">
                  {new Date(t.createdAt).toLocaleString('en-GB')} · Balance {formatMWK(t.newBalance)}
                  {t.store ? ` · ${t.store.name}` : ''}
                </div>
              </div>
            ))
          )}
          <div className="pagination">
            <button className="btn secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
            <span className="muted">Page {data.pagination.page} of {Math.max(1, data.pagination.pages)}</span>
            <button className="btn secondary" disabled={page >= data.pagination.pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </>
      )}
      <p style={{ textAlign: 'center' }}><Link to="/portal">Back</Link></p>
    </div>
  );
}
