import { useCallback, useEffect, useState } from 'react';
import api from '../services/api.js';
import { formatMWK } from '../utils/format.js';

// ADMIN-only maker-checker queue: large top-ups captured by managers wait
// here with their proof of payment until approved (credits) or rejected.
export default function Approvals() {
  const [status, setStatus] = useState('PENDING');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState({ kind: '', text: '' });
  const [notes, setNotes] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/wallets/approvals?status=${status}&limit=50`);
      setData(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load approvals');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const viewProof = async (id) => {
    try {
      const { data } = await api.get(`/wallets/approvals/${id}/proof`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      setMsg({ kind: 'error', text: 'Could not open the proof of payment.' });
    }
  };

  const decide = async (id, action) => {
    setBusy(id);
    setMsg({ kind: '', text: '' });
    try {
      const { data } = action === 'approve'
        ? await api.post(`/wallets/approvals/${id}/approve`)
        : await api.post(`/wallets/approvals/${id}/reject`, { note: notes[id] || '' });
      setMsg({
        kind: 'ok',
        text: action === 'approve'
          ? `Approved — credited ${formatMWK(data.transaction.amount)}.`
          : 'Rejected — no money moved.',
      });
      load();
    } catch (err) {
      setMsg({ kind: 'error', text: err.response?.data?.error || `${action} failed.` });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="container wide">
      <div className="page-head"><h1>Top-up Approvals</h1></div>
      {data?.threshold > 0 && (
        <p className="muted">Top-ups at or above {formatMWK(data.threshold)} captured by non-admin staff wait here for approval.</p>
      )}
      {msg.text && <p className={msg.kind === 'error' ? 'error' : 'muted'}>{msg.text}</p>}
      <div className="tabs">
        {['PENDING', 'APPROVED', 'REJECTED'].map((s) => (
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
          <div className="card"><p className="muted">No {status.toLowerCase()} requests.</p></div>
        ) : (
          <div className="card">
            <table className="table">
              <thead><tr><th>Date</th><th>Customer</th><th>Amount</th><th>Method</th><th>Reference</th><th>Proof</th><th>Captured By</th><th></th></tr></thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.createdAt).toLocaleString('en-GB')}</td>
                    <td>{r.customer?.name ?? '—'}</td>
                    <td>{formatMWK(r.amount)}</td>
                    <td>{r.method}</td>
                    <td>{r.paymentReference || '—'}</td>
                    <td>{r.hasProof ? <button className="btn secondary" onClick={() => viewProof(r.id)}>View</button> : '—'}</td>
                    <td>{r.requestedBy?.name ?? '—'}</td>
                    <td>
                      {r.status === 'PENDING' && (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <button className="btn success" disabled={busy === r.id} onClick={() => decide(r.id, 'approve')}>
                            {busy === r.id ? '…' : 'Approve'}
                          </button>
                          <input className="input" placeholder="Reject note…" style={{ maxWidth: 140 }}
                            value={notes[r.id] || ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                          <button className="btn secondary" disabled={busy === r.id} onClick={() => decide(r.id, 'reject')}>Reject</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
