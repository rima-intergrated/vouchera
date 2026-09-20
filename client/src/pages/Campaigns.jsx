import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';

const STATUSES = ['', 'DRAFT', 'ACTIVE', 'PAUSED', 'ENDED'];

export default function Campaigns() {
  const { user } = useAuth();
  const canManage = user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const [status, setStatus] = useState('');
  const [applied, setApplied] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const q = applied ? `?status=${applied}` : '';
      const { data } = await api.get(`/campaigns${q}`);
      setItems(data.campaigns ?? []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  }, [applied]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="container wide">
      <div className="page-head">
        <h1>Campaigns</h1>
        {canManage && <Link className="btn" to="/campaigns/new">Create Campaign</Link>}
      </div>

      <form className="card filters-bar" onSubmit={(e) => { e.preventDefault(); setApplied(status); }}>
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.filter(Boolean).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="btn" type="submit">Filter</button>
      </form>

      {loading && <div className="card"><p className="muted">Loading campaigns…</p></div>}
      {!loading && error && (
        <div className="card error-state">
          <p className="error">{error}</p>
          <button className="btn" onClick={load}>Retry</button>
        </div>
      )}
      {!loading && !error && (
        <div className="card">
          {items.length === 0 ? (
            <p className="muted">No campaigns yet. Create the first one to get started.</p>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Name</th><th>Code</th><th>Voucher</th><th>Qty</th><th>Generated</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c._id}>
                    <td><strong>{c.name}</strong></td>
                    <td>{c.code}</td>
                    <td>{c.voucherValue ? `K${Number(c.voucherValue).toLocaleString('en-MW', { minimumFractionDigits: 2 })}` : '—'}</td>
                    <td>{c.voucherQuantity}</td>
                    <td>{c.generatedCount}</td>
                    <td><span className={`badge status-${c.status}`}>{c.status}</span></td>
                    <td><Link to={`/campaigns/${c._id}`}>View</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
