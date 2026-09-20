import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatMWK } from '../utils/format.js';

// Customer portal home: wallet + issued vouchers behind a toggle.
// Read-only — money moves only via staff-recorded transactions.
export default function Portal() {
  const { user } = useAuth();
  const [tab, setTab] = useState('wallet');
  const [ledger, setLedger] = useState(null);
  const [qr, setQr] = useState(null);
  const [vouchers, setVouchers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (tab !== 'vouchers' || vouchers) return;
    api.get('/wallets/vouchers?limit=50')
      .then(({ data }) => setVouchers(data))
      .catch(() => setVouchers({ items: [], error: true }));
  }, [tab, vouchers]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.get('/wallets/transactions?limit=5'), api.get('/wallets/qr')])
      .then(([{ data: l }, { data: q }]) => {
        if (!cancelled) {
          setLedger(l);
          setQr(q);
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
        <button className={tab === 'vouchers' ? 'tab active' : 'tab'} onClick={() => setTab('vouchers')}>My Vouchers</button>
      </div>

      {tab === 'vouchers' ? (
        <MyVouchers vouchers={vouchers} />
      ) : (
        <>
      <div className="card balance-hero">
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
