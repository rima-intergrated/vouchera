import { useCallback, useEffect, useState } from 'react';
import api from '../services/api.js';

function buildQuery(params) {
  const clean = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== '' && v !== null && v !== undefined) clean[k] = v;
  }
  const q = new URLSearchParams(clean).toString();
  return q ? `?${q}` : '';
}

// Read-only audit trail (ADMIN, AUDITOR). No edit/delete actions exist anywhere.
export default function AuditLogs() {
  const [f, setF] = useState({ action: '', entity: '', from: '', to: '' });
  const [applied, setApplied] = useState({});
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/audit-logs${buildQuery({ ...applied, page, limit: 20 })}`);
      setData(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [applied, page]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (k, v) => setF((prev) => ({ ...prev, [k]: v }));
  const apply = (e) => {
    e.preventDefault();
    setPage(1);
    setApplied(f);
  };

  return (
    <div className="container wide">
      <div className="page-head"><h1>Audit Logs</h1></div>
      <form className="card filters-bar" onSubmit={apply}>
        <input className="input" placeholder="Action (e.g. voucher.redeem)" value={f.action} onChange={(e) => set('action', e.target.value)} />
        <input className="input" placeholder="Entity (e.g. Voucher)" value={f.entity} onChange={(e) => set('entity', e.target.value)} />
        <input type="date" className="input" value={f.from} onChange={(e) => set('from', e.target.value)} />
        <input type="date" className="input" value={f.to} onChange={(e) => set('to', e.target.value)} />
        <button className="btn" type="submit">Filter</button>
      </form>

      {loading && <div className="card"><p className="muted">Loading audit logs…</p></div>}
      {!loading && error && (
        <div className="card error-state">
          <p className="error">{error}</p>
          <button className="btn" onClick={load}>Retry</button>
        </div>
      )}
      {!loading && !error && data && (
        <div className="card">
          {data.items.length === 0 ? (
            <p className="muted">No audit records match the current filters.</p>
          ) : (
            <>
              <table className="table">
                <thead>
                  <tr><th>Date/Time</th><th>User</th><th>Role</th><th>Action</th><th>Entity</th><th>Entity ID</th><th>IP</th></tr>
                </thead>
                <tbody>
                  {data.items.map((a) => (
                    <tr key={a.id} title={a.metadata ? JSON.stringify(a.metadata) : ''}>
                      <td>{new Date(a.timestamp).toLocaleString('en-GB')}</td>
                      <td>{a.actor?.name || a.actorEmail || '—'}</td>
                      <td>{a.actor?.role || a.actorRole || '—'}</td>
                      <td>{a.action}</td>
                      <td>{a.entity}</td>
                      <td className="muted small">{a.entityId || '—'}</td>
                      <td className="muted small">{a.ip || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="pagination">
                <button className="btn secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
                <span className="muted">Page {data.pagination.page} of {Math.max(1, data.pagination.pages)} ({data.pagination.total})</span>
                <button className="btn secondary" disabled={page >= data.pagination.pages} onClick={() => setPage((p) => p + 1)}>Next</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
