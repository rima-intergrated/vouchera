import { useState } from 'react';
import { useSummary } from '../hooks/useReports.js';
import { formatMWK } from '../utils/format.js';

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatCard({ label, value, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  );
}

function SkeletonCards() {
  return (
    <div className="stat-grid">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="stat-card skeleton">Loading…</div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [applied, setApplied] = useState({ from: '', to: '' });
  const { data, loading, error, retry } = useSummary(applied);

  const apply = (e) => {
    e.preventDefault();
    setApplied({ from, to });
  };
  const clear = () => {
    setFrom('');
    setTo('');
    setApplied({ from: '', to: '' });
  };

  return (
    <div className="container wide">
      <div className="page-head">
        <h1>Dashboard</h1>
        <form className="filters" onSubmit={apply}>
          <label>From <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>To <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <button className="btn" type="submit">Apply</button>
          <button className="btn secondary" type="button" onClick={clear}>Clear</button>
        </form>
      </div>

      {loading && <SkeletonCards />}

      {!loading && error && (
        <div className="card error-state">
          <p className="error">Could not load dashboard: {error}</p>
          <button className="btn" onClick={retry}>Retry</button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          <div className="stat-grid">
            <StatCard label="Total Vouchers" value={data.vouchers.total} />
            <StatCard label="Active Vouchers" value={data.vouchers.active} />
            <StatCard label="Redeemed Vouchers" value={data.vouchers.redeemed} />
            <StatCard label="Expired Vouchers" value={data.vouchers.expired} />
            <StatCard label="Total Value Issued" value={formatMWK(data.values.totalIssued)} />
            <StatCard label="Total Value Redeemed" value={formatMWK(data.values.totalRedeemed)} />
            <StatCard label="Outstanding Value" value={formatMWK(data.values.outstanding)} />
            <StatCard
              label="Today's Redemptions"
              value={data.redemptions.today.count}
              sub={formatMWK(data.redemptions.today.value)}
            />
          </div>

          <div className="grid-2">
            <div className="card">
              <h2>Voucher Status Summary</h2>
              {Object.keys(data.vouchers.byStatus).length === 0 ? (
                <p className="muted">No vouchers issued yet.</p>
              ) : (
                <ul className="status-list">
                  {Object.entries(data.vouchers.byStatus).map(([status, count]) => (
                    <li key={status}>
                      <span className={`badge status-${status}`}>{status}</span>
                      <strong>{count}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="card">
              <h2>Redemption Activity by Store</h2>
              <table className="table">
                <thead>
                  <tr><th>Store</th><th>Redemptions</th><th>Value</th></tr>
                </thead>
                <tbody>
                  {data.activityByStore.map((row) => (
                    <tr key={row.store.id}>
                      <td>{row.store.name}</td>
                      <td>{row.redemptions}</td>
                      <td>{formatMWK(row.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h2>Recent Redemptions</h2>
            {data.recentRedemptions.length === 0 ? (
              <p className="muted">No redemptions in the selected period.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Reference</th><th>Voucher/Wallet</th><th>Amount</th>
                    <th>Store</th><th>Cashier</th><th>POS Ref</th><th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentRedemptions.map((r) => (
                    <tr key={r.id}>
                      <td>{r.redemptionReference}</td>
                      <td>{r.voucherCode ?? r.walletCode ?? '—'}</td>
                      <td>{formatMWK(r.amountRedeemed)}</td>
                      <td>{r.store?.name ?? '—'}</td>
                      <td>{r.cashier?.name ?? '—'}</td>
                      <td>{r.posTransactionReference}</td>
                      <td>{formatDateTime(r.redeemedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
