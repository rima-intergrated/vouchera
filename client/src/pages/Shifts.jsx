import { useCallback, useEffect, useState } from 'react';
import api from '../services/api.js';
import { formatMWK } from '../utils/format.js';

// Closeout oversight: every closed shift with expected vs declared cash and
// the variance. Non-zero variances are the starting point for investigation
// (short drawer, unrecorded tender, mis-keyed bill split).
export default function Shifts() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('CLOSED');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/shifts?status=${status}&limit=50`);
      setData(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load shifts');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="container wide">
      <div className="page-head"><h1>Shift Closeouts</h1></div>
      <div className="tabs">
        {['CLOSED', 'OPEN'].map((s) => (
          <button key={s} className={status === s ? 'tab active' : 'tab'} onClick={() => setStatus(s)}>{s}</button>
        ))}
      </div>
      {loading && <div className="card"><p className="muted">Loading…</p></div>}
      {!loading && error && (
        <div className="card error-state">
          <p className="error">{error}</p>
          <button className="btn" onClick={load}>Retry</button>
        </div>
      )}
      {!loading && !error && data && (
        data.items.length === 0 ? (
          <div className="card"><p className="muted">No {status.toLowerCase()} shifts.</p></div>
        ) : (
          <div className="card">
            <table className="table">
              <thead><tr><th>Cashier</th><th>Store</th><th>Opened</th><th>Closed</th><th>Sales</th><th>Expected Cash</th><th>Declared</th><th>Variance</th><th>VISA</th></tr></thead>
              <tbody>
                {data.items.map((s) => (
                  <tr key={s.id} style={s.status === 'CLOSED' && s.varianceCash !== 0 ? { background: 'rgba(180,30,30,0.08)' } : undefined}>
                    <td><strong>{s.cashier?.name ?? '—'}</strong></td>
                    <td>{s.store?.name ?? '—'}</td>
                    <td>{new Date(s.openedAt).toLocaleString('en-GB')}</td>
                    <td>{s.closedAt ? new Date(s.closedAt).toLocaleString('en-GB') : '—'}</td>
                    <td>{s.redemptionCount} sales · {s.topupCount} top-ups</td>
                    <td>{s.expectedCash != null ? formatMWK(s.expectedCash) : '—'}</td>
                    <td>{s.declaredCash != null ? formatMWK(s.declaredCash) : '—'}</td>
                    <td>
                      {s.varianceCash == null ? '—' : s.varianceCash === 0
                        ? <span className="muted">0</span>
                        : <strong className="error">{formatMWK(s.varianceCash)}</strong>}
                    </td>
                    <td>{s.expectedVisa != null ? formatMWK(s.expectedVisa) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">Expected cash = CASH top-ups received + CASH tenders collected. VISA column matches the bank settlement slip.</p>
          </div>
        )
      )}
    </div>
  );
}
