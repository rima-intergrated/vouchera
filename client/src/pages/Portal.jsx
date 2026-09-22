import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatMWK } from '../utils/format.js';

// Customer portal home: wallet + loyalty + issued vouchers behind tabs.
// Read-only for money — the only write is the customer's own till PIN.
export default function Portal() {
  const { user } = useAuth();
  const [tab, setTab] = useState('wallet');
  const [ledger, setLedger] = useState(null);
  const [qr, setQr] = useState(null);
  const [vouchers, setVouchers] = useState(null);
  const [me, setMe] = useState(null);
  const [loyaltyTxns, setLoyaltyTxns] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (tab !== 'vouchers' || vouchers) return;
    api.get('/wallets/vouchers?limit=50')
      .then(({ data }) => setVouchers(data))
      .catch(() => setVouchers({ items: [], error: true }));
  }, [tab, vouchers]);

  useEffect(() => {
    if (tab !== 'loyalty' || loyaltyTxns) return;
    api.get('/loyalty/transactions?limit=20')
      .then(({ data }) => setLoyaltyTxns(data))
      .catch(() => setLoyaltyTxns({ items: [], error: true }));
  }, [tab, loyaltyTxns]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.get('/wallets/transactions?limit=5'), api.get('/wallets/qr'), api.get('/customers/me')])
      .then(([{ data: l }, { data: q }, { data: m }]) => {
        if (!cancelled) {
          setLedger(l);
          setQr(q);
          setMe(m);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.response?.data?.error || 'Failed to load your account');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="cashier-wrap">
        <h1>VOUCHERA</h1>
        <div className="card"><p className="muted">Loading your account…</p></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="cashier-wrap">
        <h1>VOUCHERA</h1>
        <div className="card error-state">
          <p className="error">{error}</p>
          <button className="btn" onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="cashier-wrap">
      <h1>VOUCHERA</h1>
      <p className="muted" style={{ textAlign: 'center' }}>Welcome, {user?.name}</p>
      <div className="tabs" style={{ justifyContent: 'center' }}>
        <button className={tab === 'wallet' ? 'tab active' : 'tab'} onClick={() => setTab('wallet')}>Wallet</button>
        <button className={tab === 'loyalty' ? 'tab active' : 'tab'} onClick={() => setTab('loyalty')}>Loyalty</button>
        <button className={tab === 'vouchers' ? 'tab active' : 'tab'} onClick={() => setTab('vouchers')}>My Vouchers</button>
        <button className={tab === 'security' ? 'tab active' : 'tab'} onClick={() => setTab('security')}>PIN</button>
      </div>

      {tab === 'vouchers' ? (
        <MyVouchers vouchers={vouchers} />
      ) : tab === 'loyalty' ? (
        <LoyaltyPanel me={me} txns={loyaltyTxns} />
      ) : tab === 'security' ? (
        <PinPanel pinSet={me?.pinSet} onChanged={() => api.get('/customers/me').then(({ data }) => setMe(data)).catch(() => {})} />
      ) : (
        <>
      {!me?.pinSet && (
        <div className="card confirm-box">
          <p><strong>Set your payment PIN</strong></p>
          <p className="muted small">You need a 4-digit PIN to authorise payments when your code is scanned at the till.</p>
          <button className="btn" onClick={() => setTab('security')}>Set PIN now</button>
        </div>
      )}      <div className="card balance-hero">
        <div className="muted">Your Balance</div>
        <div className="balance-value">{formatMWK(ledger.customer.walletBalance)}</div>
      </div>

      <div className="card qr-card">
        <h2>Pay with this QR</h2>
        {qr && <img src={qr.qrCode} alt="Your wallet QR code" width="220" height="220" />}
        <p><strong>{qr?.code}</strong></p>
        <p className="muted small">Show this code at any Shopwise till to pay from your balance.</p>
      </div>

      <div className="card">
        <h2>Recent Activity</h2>
        {ledger.items.length === 0 ? (
          <p className="muted">No transactions yet. Top up at any till to get started.</p>
        ) : (
          ledger.items.map((t) => (
            <div className="history-item" key={t.id}>
              <strong>{t.type === 'TOP_UP' ? '+' : '−'}{formatMWK(t.amount)}</strong>{' '}
              <span className="muted small">{t.type === 'TOP_UP' ? `Top-up (${t.method})` : 'Purchase'}</span>
              <div className="muted small">{new Date(t.createdAt).toLocaleString('en-GB')} · Balance {formatMWK(t.newBalance)}</div>
            </div>
          ))
        )}
        <p style={{ textAlign: 'center' }}><Link to="/portal/history">View full history</Link></p>
      </div>
        </>
      )}
    </div>
  );
}

function LoyaltyPanel({ me, txns }) {
  const pts = me?.customer?.loyaltyPoints ?? 0;
  const value = me?.customer?.loyaltyCashValue ?? 0;
  const rate = me?.rates;
  return (
    <>
      <div className="card balance-hero">
        <div className="muted">Loyalty Points</div>
        <div className="balance-value">{pts} pts</div>
        <div className="muted">≈ {formatMWK(value)} off at the till</div>
      </div>
      <div className="card">
        <h2>How it works</h2>
        {rate ? (
          <p className="muted small">
            Earn {rate.pointsPer100MWK} pt{rate.pointsPer100MWK === 1 ? '' : 's'} per K100 you spend · 1 pt = {formatMWK(rate.mwkPerPoint)} ·
            min {rate.minRedeemPoints} pts per redemption. Tell the cashier to use your points before you enter your PIN.
          </p>
        ) : (
          <p className="muted small">Earn points on every till purchase and spend them like cash.</p>
        )}
      </div>
      <div className="card">
        <h2>Points Activity</h2>
        {!txns ? (
          <p className="muted">Loading…</p>
        ) : txns.error || txns.items.length === 0 ? (
          <p className="muted">No points yet — they appear automatically after your first till purchase.</p>
        ) : (
          txns.items.map((t) => (
            <div className="history-item" key={t.id}>
              <strong>{t.type === 'EARN' ? '+' : '−'}{t.points} pts</strong>{' '}
              <span className="muted small">{t.type === 'EARN' ? `Earned (${formatMWK(t.cashValue)} spent)` : `Redeemed (−${formatMWK(t.cashValue)})`}</span>
              <div className="muted small">{new Date(t.createdAt).toLocaleString('en-GB')} · Balance {t.newPoints} pts</div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

function PinPanel({ pinSet, onChanged }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState({ kind: '', text: '' });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setMsg({ kind: '', text: '' });
    if (!/^\d{4}$/.test(next)) {
      setMsg({ kind: 'error', text: 'PIN must be exactly 4 digits.' });
      return;
    }
    if (next !== confirm) {
      setMsg({ kind: 'error', text: 'PINs do not match.' });
      return;
    }
    setBusy(true);
    try {
      if (pinSet) {
        await api.post('/customers/me/pin/change', { currentPin: current, newPin: next });
        setMsg({ kind: 'ok', text: 'PIN changed.' });
      } else {
        await api.post('/customers/me/pin', { pin: next });
        setMsg({ kind: 'ok', text: 'PIN set — you can now authorise till payments.' });
      }
      setCurrent('');
      setNext('');
      setConfirm('');
      onChanged();
    } catch (err) {
      setMsg({ kind: 'error', text: err.response?.data?.error || 'Failed to save PIN.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>{pinSet ? 'Change payment PIN' : 'Set payment PIN'}</h2>
      <p className="muted small">
        {pinSet
          ? 'Enter your current 4-digit PIN, then choose a new one.'
          : 'Choose a 4-digit PIN. You will enter it at the till to authorise payments from your account.'}
      </p>
      <form onSubmit={submit}>
        {pinSet && (
          <div className="field">
            <label htmlFor="cur-pin">Current PIN</label>
            <input id="cur-pin" className="input cashier-input" type="password" inputMode="numeric" minLength={4} maxLength={4} autoComplete="off"
              value={current} onChange={(e) => setCurrent(e.target.value.replace(/\D/g, '').slice(0, 4))} required />
          </div>
        )}
        <div className="field">
          <label htmlFor="new-pin">{pinSet ? 'New PIN (4 digits)' : 'PIN (4 digits)'}</label>
          <input id="new-pin" className="input cashier-input" type="password" inputMode="numeric" minLength={4} maxLength={4} autoComplete="new-password"
            value={next} onChange={(e) => setNext(e.target.value.replace(/\D/g, '').slice(0, 4))} required />
        </div>
        <div className="field">
          <label htmlFor="cfm-pin">Confirm PIN</label>
          <input id="cfm-pin" className="input cashier-input" type="password" inputMode="numeric" minLength={4} maxLength={4} autoComplete="new-password"
            value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))} required />
        </div>
        {msg.text && <p className={msg.kind === 'error' ? 'error' : 'muted'}>{msg.text}</p>}
        <button className="btn" type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Saving…' : pinSet ? 'Change PIN' : 'Set PIN'}
        </button>
      </form>
      <p style={{ textAlign: 'center' }}><Link to="/forgot-pin">Forgot PIN?</Link></p>
    </div>
  );
}

function MyVouchers({ vouchers }) {
  if (!vouchers) return <div className="card"><p className="muted">Loading your vouchers…</p></div>;
  if (vouchers.error) return <div className="card"><p className="muted">Vouchers unavailable right now.</p></div>;
  if (!vouchers.items.length) {
    return <div className="card"><p className="muted">No vouchers issued to you yet. Ask at any till about gift cards and campaigns.</p></div>;
  }
  const spent = (v) => ['FULLY_REDEEMED', 'EXPIRED', 'CANCELLED'].includes(v.status);
  return (
    <>
      {vouchers.items.map((v) => (
        <div className="card" key={v.id} style={spent(v) ? { opacity: 0.75 } : undefined}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <img src={v.qrCode} alt={`QR for voucher ${v.code}`} width="110" height="110" />
            <div style={{ flex: 1, minWidth: 180 }}>
              <div><strong>{v.code}</strong> <span className={`badge status-${v.status}`}>{v.status}</span></div>
              <div className="muted small">{v.type === 'GIFT_CARD' ? 'Gift card' : 'Voucher'}{v.campaign ? ` · ${v.campaign.name}` : ''}</div>
              <div>Value {formatMWK(v.originalValue)} · Balance {formatMWK(v.remainingBalance)}</div>
              <div className="muted small">Expires {new Date(v.expiryDate).toLocaleDateString('en-GB')}</div>
            </div>
          </div>
          {!spent(v) && <p className="muted small">Show this QR at the till — the cashier scans it like any voucher.</p>}
        </div>
      ))}
    </>
  );
}
