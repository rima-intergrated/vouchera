import { useState } from 'react';
import { useLookup } from '../hooks/useVouchers.js';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../services/api.js';
import { useCallback, useEffect } from 'react';
import { formatMWK } from '../utils/format.js';

const STATUSES = ['', 'ACTIVE', 'PARTIALLY_REDEEMED', 'FULLY_REDEEMED', 'EXPIRED', 'CANCELLED', 'SUSPENDED'];

function buildQuery(params) {
  const clean = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== '' && v !== null && v !== undefined) clean[k] = v;
  }
  const q = new URLSearchParams(clean).toString();
  return q ? `?${q}` : '';
}

export default function Redemptions() {
  const { user } = useAuth();
  const { stores, campaigns } = useLookup();
  const [f, setF] = useState({ from: '', to: '', store: '', cashier: '', voucher: '', campaign: '', minAmount: '', maxAmount: '', status: '' });
  const [applied, setApplied] = useState({});
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/redemptions${buildQuery({ ...applied, page, limit: 20 })}`);
      setData(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load redemptions');
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
  const clear = () => {
    setF({ from: '', to: '', store: '', cashier: '', voucher: '', campaign: '', minAmount: '', maxAmount: '', status: '' });
    setPage(1);
    setApplied({});
  };

  const managerScoped = user?.role === 'MANAGER';

  return (
    <div className="container wide">
      <div className="page-head">
        <h1>Redemptions{managerScoped ? ' — my store' : ''}</h1>
      </div>

      <form className="card filters-bar" onSubmit={apply}>
        <input type="date" className="input" value={f.from} onChange={(e) => set('from', e.target.value)} title="From date" />
        <input type="date" className="input" value={f.to} onChange={(e) => set('to', e.target.value)} title="To date" />
        {user?.role !== 'MANAGER' && (
          <select className="select" value={f.store} onChange={(e) => set('store', e.target.value)}>
            <option value="">All stores</option>
            {stores.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select>
        )}
        <input className="input" placeholder="Cashier email" value={f.cashier} onChange={(e) => set('cashier', e.target.value)} />
        <input className="input" placeholder="Voucher code" value={f.voucher} onChange={(e) => set('voucher', e.target.value)} />
        <select className="select" value={f.campaign} onChange={(e) => set('campaign', e.target.value)}>
          <option value="">All campaigns</option>
          {campaigns.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
        </select>
        <input className="input" type="number" min="0" placeholder="Min amount" value={f.minAmount} onChange={(e) => set('minAmount', e.target.value)} />
        <input className="input" type="number" min="0" placeholder="Max amount" value={f.maxAmount} onChange={(e) => set('maxAmount', e.target.value)} />
        <select className="select" value={f.status} onChange={(e) => set('status', e.target.value)}>
          <option value="">Any status</option>
          {STATUSES.filter(Boolean).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="btn" type="submit">Filter</button>
        <button className="btn secondary" type="button" onClick={clear}>Clear</button>
      </form>

      {loading && <div className="card"><p className="muted">Loading redemptions…</p></div>}
      {!loading && error && (
        <div className="card error-state">
          <p className="error">{error}</p>
          <button className="btn" onClick={load}>Retry</button>
        </div>
      )}
      {!loading && !error && data && (
        <div className="card">
          {data.items.length === 0 ? (
            <p className="muted">No redemptions match the current filters.</p>
          ) : (
            <>
              <table className="table">
                <thead>
                  <tr><th>Reference</th><th>Source</th><th>Voucher / Wallet</th><th>Amount</th><th>Store</th><th>Cashier</th><th>POS Txn</th><th>Date/Time</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id}>
                      <td>{r.redemptionReference}</td>
                      <td>{r.source ?? 'VOUCHER'}</td>
                      <td>{r.voucherCode ?? r.walletCode ?? r.customer?.name ?? '—'}</td>
                      <td>{formatMWK(r.amountRedeemed)}</td>
                      <td>{r.store?.name ?? '—'}</td>
                      <td>{r.cashier?.name ?? '—'}</td>
                      <td>{r.posTransactionReference}</td>
                      <td>{new Date(r.redeemedAt).toLocaleString('en-GB')}</td>
                      <td><span className={`badge status-${r.status}`}>{r.status}</span></td>
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
