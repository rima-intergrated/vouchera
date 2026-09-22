import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatMWK } from '../utils/format.js';

export default function CustomerDetails() {
  const { id } = useParams();
  const { user } = useAuth();
  const canManage = user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const isAdmin = user?.role === 'ADMIN';

  const [data, setData] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [qr, setQr] = useState(null);
  const [loyalty, setLoyalty] = useState(null);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [topup, setTopup] = useState({ amount: '', method: 'CASH', reference: '', storeId: '' });
  const [topupBusy, setTopupBusy] = useState(false);
  const [topupMsg, setTopupMsg] = useState({ kind: '', text: '' });

  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginMsg, setLoginMsg] = useState({ kind: '', text: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [{ data: c }, { data: l }, { data: q }] = await Promise.all([
        api.get(`/customers/${id}`),
        api.get(`/wallets/transactions?customer=${id}&limit=20`),
        api.get(`/wallets/qr?customer=${id}`),
      ]);
      setData(c);
      setLedger(l.items ?? []);
      setQr(q);
      api.get(`/loyalty/transactions?customer=${id}&limit=10`).then(({ data }) => setLoyalty(data)).catch(() => {});
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load customer');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
    api.get('/stores?active=true').then(({ data }) => setStores(data.stores ?? [])).catch(() => {});
  }, [load]);

  const submitTopup = async (e) => {
    e.preventDefault();
    setTopupBusy(true);
    setTopupMsg({ kind: '', text: '' });
    try {
      const { data } = await api.post('/wallets/topup', {
        customerId: id,
        amount: Number(topup.amount),
        method: topup.method,
        ...(topup.reference.trim() ? { paymentReference: topup.reference.trim() } : {}),
        ...(topup.storeId ? { storeId: topup.storeId } : {}),
        idempotencyKey: crypto.randomUUID(),
      });
      setTopupMsg({ kind: 'ok', text: data.replayed ? 'Already recorded.' : `Credited ${formatMWK(data.transaction.amount)}. New balance: ${formatMWK(data.walletBalance)}.` });
      setTopup({ amount: '', method: 'CASH', reference: '', storeId: '' });
      load();
    } catch (err) {
      setTopupMsg({ kind: 'error', text: err.response?.data?.error || 'Top-up failed.' });
    } finally {
      setTopupBusy(false);
    }
  };

  const createLogin = async (e) => {
    e.preventDefault();
    setLoginBusy(true);
    setLoginMsg({ kind: '', text: '' });
    try {
      await api.post('/auth/users', {
        name: data.customer.name,
        email: loginForm.email,
        password: loginForm.password,
        role: 'CUSTOMER',
        customer: id,
      });
      setLoginMsg({ kind: 'ok', text: 'Portal login created.' });
      setLoginForm({ email: '', password: '' });
      load();
    } catch (err) {
      setLoginMsg({ kind: 'error', text: err.response?.data?.error || 'Failed to create login.' });
    } finally {
      setLoginBusy(false);
    }
  };

  if (loading) return <div className="container wide"><div className="card"><p className="muted">Loading customer…</p></div></div>;
  if (error) {
    return (
      <div className="container wide">
        <div className="card error-state">
          <p className="error">{error}</p>
          <button className="btn" onClick={load}>Retry</button>
        </div>
      </div>
    );
  }

  const { customer, stats, login } = data;

  return (
    <div className="container wide">
      <p><Link to="/customers">← Back to customers</Link></p>
      <div className="page-head"><h1>{customer.name}</h1></div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <div className="stat-card"><div className="stat-label">Wallet Balance</div><div className="stat-value" style={{ fontSize: 24 }}>{formatMWK(customer.walletBalance)}</div></div>
        <div className="stat-card"><div className="stat-label">Topped Up</div><div className="stat-value" style={{ fontSize: 24 }}>{formatMWK(stats.toppedUp)}</div></div>
        <div className="stat-card"><div className="stat-label">Spent</div><div className="stat-value" style={{ fontSize: 24 }}>{formatMWK(stats.spent)}</div></div>
        <div className="stat-card"><div className="stat-label">Loyalty Points</div><div className="stat-value" style={{ fontSize: 24 }}>{stats.loyaltyPoints ?? 0} pts</div></div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Account</h2>
          <dl className="details">
            <div><dt>Phone</dt><dd>{customer.phone || '—'}</dd></div>
            <div><dt>Email</dt><dd>{customer.email || '—'}</dd></div>
            <div><dt>Wallet Code</dt><dd>{customer.walletCode || '—'}</dd></div>
            <div><dt>Payment PIN</dt><dd>{customer.pinSet ? 'Set' : 'Not set'}</dd></div>
            <div><dt>Loyalty</dt><dd>{stats.loyaltyPoints ?? 0} pts · earned {stats.loyaltyEarned ?? 0} · redeemed {stats.loyaltyRedeemed ?? 0}</dd></div>
            <div><dt>Notes</dt><dd>{customer.notes || '—'}</dd></div>
            <div><dt>Portal Login</dt><dd>{login ? `${login.email} (${login.isActive ? 'active' : 'disabled'})` : 'None'}</dd></div>
          </dl>
          {qr && (
            <div className="qr-card">
              <img src={qr.qrCode} alt="Customer wallet QR" width="180" height="180" />
              <p className="muted small">Customer scans this at the till to pay from their balance.</p>
            </div>
          )}
        </div>

        <div>
          {canManage && (
            <div className="card">
              <h2>Top Up Wallet</h2>
              <form onSubmit={submitTopup}>
                <div className="field">
                  <label>Amount (MWK)<input className="input" type="number" min="0.01" step="0.01" required value={topup.amount} onChange={(e) => setTopup({ ...topup, amount: e.target.value })} /></label>
                </div>
                <div className="field" style={{ display: 'flex', gap: 10 }}>
                  <label style={{ flex: 1 }}>Method
                    <select className="select" value={topup.method} onChange={(e) => setTopup({ ...topup, method: e.target.value })}>
                      <option value="CASH">Cash (verified at till)</option>
                      <option value="TRANSFER">Money transfer</option>
                    </select>
                  </label>
                  <label style={{ flex: 1 }}>Store
                    <select className="select" value={topup.storeId} onChange={(e) => setTopup({ ...topup, storeId: e.target.value })}>
                      <option value="">—</option>
                      {stores.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
                    </select>
                  </label>
                </div>
                <div className="field">
                  <label>Payment Reference{topup.method === 'TRANSFER' ? ' (required)' : ''}<input className="input" value={topup.reference} onChange={(e) => setTopup({ ...topup, reference: e.target.value })} required={topup.method === 'TRANSFER'} /></label>
                </div>
                {topupMsg.text && <p className={topupMsg.kind === 'error' ? 'error' : 'muted'}>{topupMsg.text}</p>}
                <button className="btn" type="submit" disabled={topupBusy} style={{ width: '100%' }}>
                  {topupBusy ? 'Processing…' : 'Credit Wallet'}
                </button>
              </form>
            </div>
          )}

          {isAdmin && (
            <div className="card">
              <h2>Portal Login</h2>
              {login ? (
                <p className="muted">{login.email} can sign in to the customer portal.</p>
              ) : (
                <form onSubmit={createLogin}>
                  <div className="field">
                    <label>Login Email<input className="input" type="email" required value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} /></label>
                  </div>
                  <div className="field">
                    <label>Password (min 8 chars)<input className="input" type="password" required minLength={8} value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} /></label>
                  </div>
                  {loginMsg.text && <p className={loginMsg.kind === 'error' ? 'error' : 'muted'}>{loginMsg.text}</p>}
                  <button className="btn secondary" type="submit" disabled={loginBusy} style={{ width: '100%' }}>
                    {loginBusy ? 'Creating…' : 'Create Portal Login'}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Loyalty Ledger</h2>
        {!loyalty || loyalty.items.length === 0 ? (
          <p className="muted">No points activity yet.</p>
        ) : (
          <table className="table">
            <thead><tr><th>Date</th><th>Type</th><th>Points</th><th>Cash Value</th><th>Balance After</th><th>Store</th></tr></thead>
            <tbody>
              {loyalty.items.map((t) => (
                <tr key={t.id}>
                  <td>{new Date(t.createdAt).toLocaleString('en-GB')}</td>
                  <td>{t.type}</td>
                  <td>{t.points}</td>
                  <td>{formatMWK(t.cashValue)}</td>
                  <td>{t.newPoints} pts</td>
                  <td>{t.store?.name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Wallet Ledger</h2>
        {ledger.length === 0 ? (
          <p className="muted">No transactions yet.</p>
        ) : (
          <table className="table">
            <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Balance After</th><th>Method</th><th>Reference</th><th>Store</th></tr></thead>
            <tbody>
              {ledger.map((t) => (
                <tr key={t.id}>
                  <td>{new Date(t.createdAt).toLocaleString('en-GB')}</td>
                  <td>{t.type}</td>
                  <td>{formatMWK(t.amount)}</td>
                  <td>{formatMWK(t.newBalance)}</td>
                  <td>{t.method}</td>
                  <td>{t.paymentReference || '—'}</td>
                  <td>{t.store?.name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
