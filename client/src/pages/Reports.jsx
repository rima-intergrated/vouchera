import { useCallback, useEffect, useState } from 'react';
import { useAnalytics, useRedemptions, downloadCsv } from '../hooks/useReports.js';
import { useLookup } from '../hooks/useVouchers.js';
import { useAuth } from '../context/AuthContext.jsx';
import ReceiptModal from '../components/ReceiptModal.jsx';
import api from '../services/api.js';
import { formatMWK } from '../utils/format.js';

const TABS = [
  { id: 'redemption', label: 'Redemption' },
  { id: 'issuance', label: 'Issuance' },
  { id: 'liability', label: 'Liability' },
  { id: 'expired', label: 'Expired' },
  { id: 'by-store', label: 'By Store' },
  { id: 'by-cashier', label: 'By Cashier' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'daily', label: 'Daily' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'reconciliation', label: 'Reconciliation' },
  { id: 'anomalies', label: 'Anomalies' },
  { id: 'sales', label: 'Sales Ledger' },
];

const NO_DATES = new Set(['liability', 'anomalies', 'sales']);

// Tabs that render their own filter controls — the generic bar stays hidden
// there so two date pickers never stack (sales + anomalies).
const OWN_FILTERS = new Set(['anomalies', 'sales']);

function DataTable({ columns, rows, emptyText }) {
  if (!rows?.length) return <p className="muted">{emptyText ?? 'No data in the selected period.'}</p>;
  return (
    <table className="table">
      <thead>
        <tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {columns.map((c) => (
              <td key={c.key}>{c.money ? formatMWK(r[c.key]) : String(r[c.key] ?? '—')}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Totals({ items }) {
  return (
    <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
      {items.map((t) => (
        <div className="stat-card" key={t.label}>
          <div className="stat-label">{t.label}</div>
          <div className="stat-value" style={{ fontSize: 22 }}>{t.value}</div>
        </div>
      ))}
    </div>
  );
}

function AnalyticsTab({ endpoint, params, csvName, children }) {
  const { data, loading, error, retry } = useAnalytics(endpoint, params);
  const [exporting, setExporting] = useState(false);

  const onExport = async () => {
    setExporting(true);
    try {
      await downloadCsv(endpoint, params, csvName);
    } catch {
      // eslint-disable-next-line no-alert
      alert('CSV export failed. Try again.');
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <div className="card"><p className="muted">Loading report…</p></div>;
  if (error) {
    return (
      <div className="card error-state">
        <p className="error">Could not load report: {error}</p>
        <button className="btn" onClick={retry}>Retry</button>
      </div>
    );
  }
  return (
    <>
      {children(data)}
      <div style={{ marginTop: 12 }}>
        <button className="btn secondary" onClick={onExport} disabled={exporting}>
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>
    </>
  );
}

export default function Reports() {
  const { user } = useAuth();
  const { stores, campaigns } = useLookup();
  const [tab, setTab] = useState('redemption');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [store, setStore] = useState('');
  const [campaign, setCampaign] = useState('');
  const [applied, setApplied] = useState({ from: '', to: '', store: '', campaign: '' });

  const apply = (e) => {
    e.preventDefault();
    setApplied({ from, to, store, campaign });
  };

  const showDates = !NO_DATES.has(tab);
  const showStore = ['issuance', 'by-store', 'by-cashier'].includes(tab) && user?.role !== 'MANAGER';
  const showCampaign = tab === 'issuance';

  return (
    <div className="container wide">
      <div className="page-head"><h1>Reports</h1></div>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {!OWN_FILTERS.has(tab) && (
      <form className="card filters-bar" onSubmit={apply}>
        {showDates && (
          <>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} title="From" />
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} title="To" />
          </>
        )}
        {showStore && (
          <select className="select" value={store} onChange={(e) => setStore(e.target.value)}>
            <option value="">All stores</option>
            {stores.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select>
        )}
        {showCampaign && (
          <select className="select" value={campaign} onChange={(e) => setCampaign(e.target.value)}>
            <option value="">All campaigns</option>
            {campaigns.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </select>
        )}
        <button className="btn" type="submit">Apply</button>
      </form>
      )}

      {tab === 'redemption' && <RedemptionTab applied={applied} />}
      {tab === 'issuance' && (
        <AnalyticsTab endpoint="issuance" params={applied} csvName="voucher-issuance.csv">
          {(d) => (
            <>
              <Totals items={[
                { label: 'Vouchers Issued', value: d.totals.count },
                { label: 'Value Issued', value: formatMWK(d.totals.value) },
              ]} />
              <div className="card">
                <h2>Issuance by Day</h2>
                <DataTable
                  columns={[{ key: 'date', label: 'Date' }, { key: 'issued', label: 'Issued' }, { key: 'value', label: 'Value', money: true }]}
                  rows={d.byDay}
                />
              </div>
            </>
          )}
        </AnalyticsTab>
      )}
      {tab === 'liability' && (
        <AnalyticsTab endpoint="liability" params={{ campaign: applied.campaign }} csvName="outstanding-liability.csv">
          {(d) => (
            <>
              <Totals items={[
                { label: 'Outstanding Vouchers', value: d.totals.count },
                { label: 'Outstanding Liability', value: formatMWK(d.totals.outstanding) },
                { label: 'Expiring in 30 Days', value: `${d.expiring30Days.count} (${formatMWK(d.expiring30Days.outstanding)})` },
              ]} />
              <div className="card">
                <h2>Liability by Campaign</h2>
                <DataTable
                  columns={[{ key: 'campaign', label: 'Campaign' }, { key: 'vouchers', label: 'Vouchers' }, { key: 'outstanding', label: 'Outstanding', money: true }]}
                  rows={d.byCampaign}
                />
              </div>
            </>
          )}
        </AnalyticsTab>
      )}
      {tab === 'expired' && (
        <AnalyticsTab endpoint="expired" params={applied} csvName="expired-vouchers.csv">
          {(d) => (
            <>
              <Totals items={[
                { label: 'Expired Vouchers', value: d.totals.count },
                { label: 'Written-Off Value', value: formatMWK(d.totals.lostValue) },
              ]} />
              <div className="card">
                <h2>Expired Vouchers</h2>
                <DataTable
                  columns={[{ key: 'code', label: 'Code' }, { key: 'originalValue', label: 'Original', money: true }, { key: 'lostValue', label: 'Written Off', money: true }, { key: 'expiryDate', label: 'Expiry' }, { key: 'customer', label: 'Customer' }]}
                  rows={d.items}
                />
              </div>
            </>
          )}
        </AnalyticsTab>
      )}
      {tab === 'by-store' && (
        <AnalyticsTab endpoint="by-store" params={applied} csvName="redemption-by-store.csv">
          {(d) => (
            <div className="card">
              <h2>Redemption by Store</h2>
              <DataTable
                columns={[{ key: 'store', label: 'Store' }, { key: 'redemptions', label: 'Redemptions' }, { key: 'value', label: 'Value', money: true }, { key: 'uniqueVouchers', label: 'Vouchers' }, { key: 'avgTicket', label: 'Avg Ticket', money: true }]}
                rows={d.rows}
              />
            </div>
          )}
        </AnalyticsTab>
      )}
      {tab === 'by-cashier' && (
        <AnalyticsTab endpoint="by-cashier" params={applied} csvName="redemption-by-cashier.csv">
          {(d) => (
            <div className="card">
              <h2>Redemption by Cashier</h2>
              <DataTable
                columns={[{ key: 'cashier', label: 'Cashier' }, { key: 'email', label: 'Email' }, { key: 'store', label: 'Store' }, { key: 'redemptions', label: 'Redemptions' }, { key: 'value', label: 'Value', money: true }]}
                rows={d.rows}
              />
            </div>
          )}
        </AnalyticsTab>
      )}
      {tab === 'campaigns' && (
        <AnalyticsTab endpoint="campaigns" params={applied} csvName="campaign-performance.csv">
          {(d) => (
            <div className="card">
              <h2>Campaign Performance</h2>
              <DataTable
                columns={[{ key: 'campaign', label: 'Campaign' }, { key: 'issued', label: 'Issued' }, { key: 'issuedValue', label: 'Issued Value', money: true }, { key: 'redemptions', label: 'Redemptions' }, { key: 'redeemedValue', label: 'Redeemed', money: true }, { key: 'outstanding', label: 'Outstanding', money: true }, { key: 'redemptionRate', label: 'Rate %' }]}
                rows={d.rows.map((r) => ({ ...r, redemptionRate: `${r.redemptionRate}%` }))}
              />
            </div>
          )}
        </AnalyticsTab>
      )}
      {tab === 'daily' && (
        <AnalyticsTab endpoint="daily" params={applied} csvName="daily-redemptions.csv">
          {(d) => (
            <div className="card">
              <h2>Daily Redemption Summary</h2>
              <DataTable
                columns={[{ key: 'period', label: 'Date' }, { key: 'redemptions', label: 'Redemptions' }, { key: 'redeemedValue', label: 'Redeemed', money: true }, { key: 'issued', label: 'Issued' }, { key: 'issuedValue', label: 'Issued Value', money: true }]}
                rows={d.rows}
              />
            </div>
          )}
        </AnalyticsTab>
      )}
      {tab === 'monthly' && (
        <AnalyticsTab endpoint="monthly" params={applied} csvName="monthly-redemptions.csv">
          {(d) => (
            <div className="card">
              <h2>Monthly Redemption Summary</h2>
              <DataTable
                columns={[{ key: 'period', label: 'Month' }, { key: 'redemptions', label: 'Redemptions' }, { key: 'redeemedValue', label: 'Redeemed', money: true }, { key: 'issued', label: 'Issued' }, { key: 'issuedValue', label: 'Issued Value', money: true }]}
                rows={d.rows}
              />
            </div>
          )}
        </AnalyticsTab>
      )}
      {tab === 'reconciliation' && (
        <AnalyticsTab endpoint="reconciliation" params={{}} csvName="reconciliation.csv">
          {(d) => (
            <>
              <Totals items={[
                { label: 'Money In', value: formatMWK(d.totals.inTotal) },
                { label: 'Money Out + Written Off', value: formatMWK(d.totals.outTotal) },
                { label: 'Outstanding', value: formatMWK(d.totals.outstandingTotal) },
                { label: 'DRIFT (must be 0)', value: formatMWK(d.totals.drift) },
              ]} />
              <div className="card">
                <h2>Reconciliation</h2>
                <DataTable
                  columns={[{ key: 'label', label: 'Item' }, { key: 'value', label: 'Value', money: true }]}
                  rows={[
                    { label: 'Voucher issued', value: d.inflows.voucherIssued },
                    { label: 'Wallet top-ups', value: d.inflows.walletTopups },
                    { label: 'Gift card reloads', value: d.inflows.giftReloads },
                    { label: 'Voucher redeemed', value: d.outflows.voucherRedeemed },
                    { label: 'Wallet debits', value: d.outflows.walletDebits },
                    { label: 'Expired written off', value: d.outflows.expiredWrittenOff },
                    { label: 'Cancelled forfeited', value: d.outflows.cancelledForfeited },
                    { label: 'Outstanding (vouchers)', value: d.outstanding.vouchers },
                    { label: 'Outstanding (wallets)', value: d.outstanding.wallets },
                  ]}
                />
                {d.totals.drift !== 0 && (
                  <p className="error">Non-zero drift — money moved outside the ledger. Investigate immediately.</p>
                )}
              </div>
            </>
          )}
        </AnalyticsTab>
      )}
      {tab === 'anomalies' && <AnomaliesTab />}
      {tab === 'sales' && <SalesTab stores={stores} user={user} />}
    </div>
  );
}

// Sales ledger: every sale with bill, stored-value leg and outside-money
// legs. Derived from redemptions — it cannot drift. Rows open receipts.
function SalesTab({ stores, user }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [store, setStore] = useState('');
  const [tender, setTender] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [receiptId, setReceiptId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const q = new URLSearchParams({ page, limit: 20 });
      if (from) q.set('from', from);
      if (to) q.set('to', to);
      if (store) q.set('store', store);
      if (tender) q.set('tender', tender);
      const { data } = await api.get(`/reports/sales-ledger?${q}`);
      setData(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load sales ledger');
    } finally {
      setLoading(false);
    }
  }, [from, to, store, tender, page]);

  useEffect(() => {
    load();
  }, [load]);

  const onExport = async () => {
    setExporting(true);
    try {
      await downloadCsv('sales-ledger', { from, to, store, tender }, 'sales-ledger.csv');
    } catch {
      // eslint-disable-next-line no-alert
      alert('CSV export failed. Try again.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <form className="card filters-bar" onSubmit={(e) => { e.preventDefault(); setPage(1); load(); }}>
        <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} title="From" />
        <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} title="To" />
        {user?.role !== 'MANAGER' && (
          <select className="select" value={store} onChange={(e) => setStore(e.target.value)}>
            <option value="">All stores</option>
            {stores.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select>
        )}
        <select className="select" value={tender} onChange={(e) => setTender(e.target.value)}>
          <option value="">All tenders</option>
          <option value="NONE">Stored value only</option>
          <option value="CASH">Cash tender</option>
          <option value="VISA">VISA tender</option>
        </select>
        <button className="btn" type="submit">Apply</button>
      </form>
      {loading && <div className="card"><p className="muted">Loading sales…</p></div>}
      {!loading && error && (
        <div className="card error-state">
          <p className="error">{error}</p>
          <button className="btn" onClick={load}>Retry</button>
        </div>
      )}
      {!loading && !error && data && (
        <>
          <Totals items={[
            { label: 'Sales', value: data.totals.count },
            { label: 'Bills Total', value: formatMWK(data.totals.bills) },
            { label: 'Stored Value', value: formatMWK(data.totals.stored) },
            { label: 'Cash Tender', value: formatMWK(data.totals.cash) },
            { label: 'VISA Tender', value: formatMWK(data.totals.visa) },
          ]} />
          {!data.balanced && (
            <div className="card error-state">
              <p className="error">Bills ≠ stored + cash + VISA — some rows lack bill totals (recorded before tender capture) or a split was mis-keyed.</p>
            </div>
          )}
          <div className="card">
            <h2>Sales</h2>
            {data.items.length === 0 ? (
              <p className="muted">No sales in the selected period.</p>
            ) : (
              <table className="table">
                <thead><tr><th>Date</th><th>POS Ref</th><th>Cashier</th><th>Bill</th><th>Stored</th><th>Cash</th><th>VISA</th><th>Customer</th></tr></thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id} className="clickable-row" onClick={() => setReceiptId(r.id)} title="Open receipt" style={{ cursor: 'pointer' }}>
                      <td>{new Date(r.date).toLocaleString('en-GB')}</td>
                      <td>{r.posRef}</td>
                      <td>{r.cashier?.name ?? '—'}</td>
                      <td>{r.bill != null ? formatMWK(r.bill) : '—'}</td>
                      <td>{formatMWK(r.stored)}</td>
                      <td>{r.cash ? formatMWK(r.cash) : '—'}</td>
                      <td>{r.visa ? `${formatMWK(r.visa)}${r.visaAuth ? ` · ${r.visaAuth}` : ''}` : '—'}</td>
                      <td>{r.customer?.name ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="pagination">
              <button className="btn secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
              <span className="muted">Page {data.pagination.page} of {Math.max(1, data.pagination.pages)}</span>
              <button className="btn secondary" disabled={page >= data.pagination.pages} onClick={() => setPage((p) => p + 1)}>Next</button>
              <button className="btn secondary" disabled={exporting} onClick={onExport} style={{ marginLeft: 'auto' }}>
                {exporting ? 'Exporting…' : 'Export CSV'}
              </button>
            </div>
          </div>
          {receiptId && (
            <ReceiptModal url={`/redemptions/${receiptId}/receipt`} title="Sale Receipt" onClose={() => setReceiptId(null)} />
          )}
        </>
      )}
    </>
  );
}

// Fraud tripwire: today's top-ups per staff member vs their trailing average.
// Flags spikes (3× baseline above the noise floor) and singles at/above the
// approval threshold. Check daily — every view is audit-logged server-side.
function AnomaliesTab() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/reports/topup-anomalies?days=${days}`);
      setData(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load anomaly report');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div className="card"><p className="muted">Checking top-up patterns…</p></div>;
  if (error) {
    return (
      <div className="card error-state">
        <p className="error">{error}</p>
        <button className="btn" onClick={load}>Retry</button>
      </div>
    );
  }

  return (
    <>
      <Totals items={[
        { label: 'Staff Checked', value: data.items.length },
        { label: 'Flagged', value: data.flagged },
        { label: 'Baseline Window', value: `${data.windowDays} days` },
      ]} />
      {data.flagged > 0 && (
        <div className="card error-state">
          <p className="error">{data.flagged} staff member{data.flagged === 1 ? '' : 's'} flagged — review their top-ups and proof attachments before more credits.</p>
        </div>
      )}
      <div className="card">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Top-up Activity vs Baseline</h2>
          <select className="select" value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ marginLeft: 'auto' }}>
            <option value={7}>7-day baseline</option>
            <option value={30}>30-day baseline</option>
            <option value={90}>90-day baseline</option>
          </select>
        </div>
        {data.items.length === 0 ? (
          <p className="muted">No top-ups recorded today.</p>
        ) : (
          <table className="table">
            <thead><tr><th>Staff</th><th>Today</th><th>Count</th><th>Biggest Single</th><th>Daily Avg ({data.windowDays}d)</th><th>Signal</th></tr></thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.staff.id} style={r.flagged ? { background: 'rgba(180,30,30,0.08)' } : undefined}>
                  <td><strong>{r.staff.name}</strong><div className="muted small">{r.staff.role}</div></td>
                  <td>{formatMWK(r.today.total)}</td>
                  <td>{r.today.count}</td>
                  <td>{formatMWK(r.today.maxSingle)}</td>
                  <td>{formatMWK(r.baseline.dailyAvg)}</td>
                  <td>{r.flagged ? <strong className="error">⚠ {r.reasons.join(', ').replace(/_/g, ' ')}</strong> : <span className="muted">Normal</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">Flags: 3× baseline above a {formatMWK(data.floor)} noise floor, or a single top-up at/above the {formatMWK(data.approvalThreshold)} approval threshold.</p>
      </div>
    </>
  );
}

function RedemptionTab({ applied }) {
  const [page, setPage] = useState(1);
  const { data, loading, error, retry } = useRedemptions({ ...applied, page, limit: 20 });

  if (loading) return <div className="card"><p className="muted">Loading report…</p></div>;
  if (error) {
    return (
      <div className="card error-state">
        <p className="error">Could not load report: {error}</p>
        <button className="btn" onClick={retry}>Retry</button>
      </div>
    );
  }
  return (
    <>
      <div className="card">
        <h2>Activity by Store</h2>
        <DataTable
          columns={[{ key: 'name', label: 'Store' }, { key: 'redemptions', label: 'Redemptions' }, { key: 'value', label: 'Value', money: true }]}
          rows={data.activityByStore.map((r) => ({ name: r.store.name, redemptions: r.redemptions, value: r.value }))}
        />
      </div>
      <div className="card">
        <h2>Redemptions ({data.pagination.total})</h2>
        {data.items.length === 0 ? (
          <p className="muted">No redemptions in the selected period.</p>
        ) : (
          <>
            <table className="table">
              <thead>
                <tr><th>Reference</th><th>Voucher/Wallet</th><th>Amount</th><th>Store</th><th>Date</th></tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id}>
                    <td>{r.redemptionReference}</td>
                    <td>{r.voucherCode ?? r.walletCode ?? '—'}</td>
                    <td>{formatMWK(r.amountRedeemed)}</td>
                    <td>{r.store?.name ?? '—'}</td>
                    <td>{new Date(r.redeemedAt).toLocaleString('en-GB')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="pagination">
              <button className="btn secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
              <span className="muted">Page {data.pagination.page} of {Math.max(1, data.pagination.pages)}</span>
              <button className="btn secondary" disabled={page >= data.pagination.pages} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
