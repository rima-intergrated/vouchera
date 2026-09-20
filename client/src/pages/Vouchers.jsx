import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useVouchers, useLookup } from '../hooks/useVouchers.js';
import { formatMWK } from '../utils/format.js';
import { useAuth } from '../context/AuthContext.jsx';

const STATUSES = ['ACTIVE', 'PARTIALLY_REDEEMED', 'FULLY_REDEEMED', 'EXPIRED', 'CANCELLED', 'SUSPENDED', 'DRAFT'];

export default function Vouchers() {
  const { user } = useAuth();
  const canCreate = user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const { campaigns, stores } = useLookup();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [store, setStore] = useState('');
  const [campaign, setCampaign] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [applied, setApplied] = useState({});
  const [page, setPage] = useState(1);

  const { data, loading, error, retry } = useVouchers({ ...applied, page, limit: 20 });

  const apply = (e) => {
    e.preventDefault();
    setPage(1);
    setApplied({ q, status, store, campaign, from, to });
  };
  const clear = () => {
    setQ(''); setStatus(''); setStore(''); setCampaign(''); setFrom(''); setTo('');
    setPage(1);
    setApplied({});
  };

  return (
    <div className="container wide">
      <div className="page-head">
        <h1>Vouchers</h1>
        {canCreate && <Link className="btn" to="/vouchers/new">Create Voucher</Link>}
      </div>

      <form className="card filters-bar" onSubmit={apply}>
        <input className="input" placeholder="Search code…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="select" value={store} onChange={(e) => setStore(e.target.value)}>
          <option value="">All stores</option>
          {stores.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
        </select>
        <select className="select" value={campaign} onChange={(e) => setCampaign(e.target.value)}>
          <option value="">All campaigns</option>
          {campaigns.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
        </select>
        <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        <button className="btn" type="submit">Filter</button>
        <button className="btn secondary" type="button" onClick={clear}>Clear</button>
      </form>

      {loading && <div className="card"><p className="muted">Loading vouchers…</p></div>}
      {!loading && error && (
        <div className="card error-state">
          <p className="error">Could not load vouchers: {error}</p>
          <button className="btn" onClick={retry}>Retry</button>
        </div>
      )}
      {!loading && !error && data && (
        <div className="card">
          {data.items.length === 0 ? (
            <p className="muted">No vouchers match the current filters.</p>
          ) : (
            <>
              <table className="table">
                <thead>
                  <tr><th>Code</th><th>Value</th><th>Balance</th><th>Status</th><th>Expiry</th><th></th></tr>
                </thead>
                <tbody>
                  {data.items.map((v) => (
                    <tr key={v._id}>
                      <td><strong>{v.code}</strong></td>
                      <td>{formatMWK(v.originalValue)}</td>
                      <td>{formatMWK(v.remainingBalance)}</td>
                      <td><span className={`badge status-${v.status}`}>{v.status}</span></td>
                      <td>{new Date(v.expiryDate).toLocaleDateString('en-GB')}</td>
                      <td><Link to={`/vouchers/${v._id}`}>View</Link></td>
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
