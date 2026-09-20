import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatMWK } from '../utils/format.js';

const REASON_TEXT = {
  NOT_FOUND: 'Voucher not found. Check the code and try again.',
  DRAFT: 'This voucher has not been issued yet.',
  EXPIRED: 'This voucher has expired.',
  CANCELLED: 'This voucher has been cancelled.',
  SUSPENDED: 'This voucher is suspended. Ask a manager for help.',
  FULLY_REDEEMED: 'This voucher is fully redeemed — zero balance left.',
  EMPTY: 'This wallet has zero balance. Top it up first.',
};

// WC- codes are customer wallets (portal QRs); everything else is a voucher.
// Both ride the same scan → review → confirm → success flow.
const isWalletCode = (code) => String(code || '').toUpperCase().startsWith('WC-');

export default function CashierVoucher() {
  const { code } = useParams();
  const { user } = useAuth();
  const [state, setState] = useState('validating'); // validating|invalid|valid|success
  const [result, setResult] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [amount, setAmount] = useState('');
  const [posRef, setPosRef] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [success, setSuccess] = useState(null);
  const [stores, setStores] = useState([]);
  const [storePick, setStorePick] = useState('');

  // The till store comes from the cashier's account, not from typing:
  // assigned cashiers are locked to their store; unassigned ones pick it.
  const hasAssignedStore = !!(user?.store?._id || user?.store);

  const wallet = isWalletCode(code);

  const validate = useCallback(async () => {
    setState('validating');
    setError('');
    try {
      const endpoint = wallet ? '/wallets/validate' : '/vouchers/validate';
      const { data: raw } = await api.post(endpoint, { code });
      // Normalize wallet results into the voucher-shaped view model.
      const data = wallet && raw.valid
        ? {
            valid: true,
            code: raw.code,
            voucher: {
              code: raw.code,
              originalValue: raw.wallet.balance,
              remainingBalance: raw.wallet.balance,
              expiryDate: null,
              status: 'WALLET',
              customer: { name: raw.wallet.customer },
              validStores: [],
              restrictions: {},
            },
          }
        : raw;
      setResult(data);
      setState(data.valid ? 'valid' : 'invalid');
      if (!data.valid) setReason(data.reason || 'NOT_FOUND');
    } catch (err) {
      setState('invalid');
      if (!err.response) {
        setReason('NETWORK');
        setError('Network error — check your connection and try again.');
      } else {
        setReason('NOT_FOUND');
        setError(err.response.data?.error || 'Validation failed.');
      }
    }
  }, [code, wallet]);

  useEffect(() => {
    validate();
  }, [validate]);

  useEffect(() => {
    if (hasAssignedStore || state !== 'valid') return;
    api.get('/stores?active=true').then(({ data }) => setStores(data.stores ?? [])).catch(() => {});
  }, [hasAssignedStore, state]);

  // Step 1: form submit opens an explicit review — nothing is sent yet.
  const beginConfirm = (e) => {
    e.preventDefault();
    setError('');
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter an amount greater than 0.');
      return;
    }
    if (result?.voucher && value > result.voucher.remainingBalance) {
      setError(`Amount exceeds the remaining balance (${formatMWK(result.voucher.remainingBalance)}).`);
      return;
    }
    setConfirming(true);
  };

  // Step 2: CONFIRM sends the redemption exactly once (button locked + idempotency key).
  const confirmRedeem = async () => {
    setRedeeming(true);
    setError('');
    try {
      const storeId = storePick || user?.store?._id || user?.store || undefined;
      const payload = {
        amount: Number(amount),
        posTransactionReference: posRef.trim(),
        ...(storeId ? { storeId: String(storeId) } : {}),
        idempotencyKey: crypto.randomUUID(),
      };
      const { data: raw } = wallet
        ? await api.post('/wallets/debit', { ...payload, walletCode: code })
        : await api.post('/vouchers/redeem', { ...payload, code });
      const data = wallet
        ? { replayed: raw.replayed, redemption: raw.redemption, voucher: { code: raw.wallet.code, remainingBalance: raw.wallet.remainingBalance } }
        : raw;
      setSuccess(data);
      setConfirming(false);
      setState('success');
    } catch (err) {
      if (!err.response) {
        setError('Network error — the redemption may not have gone through. Re-scan to check the balance before retrying.');
      } else {
        setError(err.response.data?.error || 'Redemption failed.');
      }
      setConfirming(false);
    } finally {
      setRedeeming(false);
    }
  };

  if (state === 'validating') {
    return (
      <div className="cashier-wrap">
        <h1>VOUCHERA</h1>
        <div className="card"><p className="muted">Checking voucher {code}…</p></div>
      </div>
    );
  }

  if (state === 'success' && success) {
    return (
      <div className="cashier-wrap">
        <div className="card success-card">
          <h1 className="success-title">{wallet ? '✓ WALLET DEBITED' : '✓ VOUCHER REDEEMED'}</h1>
          <dl className="cashier-details">
            <div><dt>Amount</dt><dd>{formatMWK(success.redemption.amountRedeemed)}</dd></div>
            <div><dt>Remaining Balance</dt><dd>{formatMWK(success.voucher.remainingBalance)}</dd></div>
            <div><dt>Reference</dt><dd>{success.redemption.redemptionReference}</dd></div>
            <div><dt>POS Transaction</dt><dd>{success.redemption.posTransactionReference}</dd></div>
            <div><dt>Date/Time</dt><dd>{new Date(success.redemption.redeemedAt).toLocaleString('en-GB')}</dd></div>
          </dl>
          {success.replayed && <p className="muted small">Already recorded — showing the original redemption.</p>}
        </div>
        <Link className="btn secondary scan-btn" to="/cashier">DONE</Link>
        <div style={{ height: 12 }} />
        <Link className="btn scan-btn" to="/cashier/scan">SCAN ANOTHER</Link>
      </div>
    );
  }

  if (state === 'invalid') {
    return (
      <div className="cashier-wrap">
        <div className="card error-state">
          <h1 className="invalid-title">{reason === 'NOT_FOUND' ? 'NOT FOUND' : 'INVALID'}</h1>
          <p><strong>{code}</strong></p>
          <p className="error">{error || REASON_TEXT[reason] || 'This voucher cannot be used.'}</p>
          <button className="btn secondary" onClick={validate}>Try again</button>
        </div>
        <Link className="btn scan-btn" to="/cashier/scan">SCAN ANOTHER</Link>
      </div>
    );
  }

  const v = result.voucher;
  const displayStore = hasAssignedStore
    ? (user?.store?.name || 'Assigned store')
    : (stores.find((s) => s._id === storePick)?.name || 'Select store below');
  const confirmAmount = Number(amount) || 0;
  const afterBalance = Math.max(0, v.remainingBalance - confirmAmount);

  return (
    <div className="cashier-wrap">
      <h1>VOUCHERA</h1>
      <div className="card balance-hero">
        <div className="muted">{wallet ? 'Wallet Balance' : 'Voucher Balance'}</div>
        <div className="balance-value">{formatMWK(v.remainingBalance)}</div>
        <div className="muted small">{v.code} · {v.status.replace('_', ' ')}</div>
      </div>

      <div className="card">
        <dl className="cashier-details">
          <div><dt>Expiry Date</dt><dd>{v.expiryDate ? new Date(v.expiryDate).toLocaleDateString('en-GB') : '—'}</dd></div>
          <div><dt>Customer</dt><dd>{v.customer ? `${v.customer.name}${v.customer.phone ? ` · ${v.customer.phone}` : ''}` : '—'}</dd></div>
          <div><dt>Stores</dt><dd>{v.validStores?.length ? v.validStores.map((s) => s.name).join(', ') : 'All stores'}</dd></div>
          {v.restrictions?.notes && <div><dt>Notes</dt><dd>{v.restrictions.notes}</dd></div>}
        </dl>
      </div>

      {confirming ? (
        <div className="card confirm-box">
          <p>You are about to redeem:</p>
          <p className="confirm-amount">{formatMWK(confirmAmount)}</p>
          <p>{wallet ? 'Wallet balance after debit:' : 'Voucher remaining after redemption:'}</p>
          <p className="confirm-amount">{formatMWK(afterBalance)}</p>
          <p className="muted small">POS: {posRef.trim()} · {displayStore}</p>
          {error && <p className="error">{error}</p>}
          <div className="confirm-actions">
            <button className="btn secondary" onClick={() => setConfirming(false)} disabled={redeeming}>CANCEL</button>
            <button className="btn success" onClick={confirmRedeem} disabled={redeeming}>
              {redeeming ? 'Processing…' : 'CONFIRM'}
            </button>
          </div>
        </div>
      ) : (
        <form className="card" onSubmit={beginConfirm}>
          <div className="field">
            <label htmlFor="amount">Amount to Redeem</label>
            <input id="amount" className="input cashier-input" type="number" min="0.01" max={v.remainingBalance} step="0.01" required
              placeholder="K____________" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="posref">POS Transaction Number</label>
            <input id="posref" className="input cashier-input" required autoComplete="off"
              placeholder="______________" value={posRef} onChange={(e) => setPosRef(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="store">Store</label>
            {hasAssignedStore ? (
              <input id="store" className="input" value={displayStore} disabled readOnly />
            ) : (
              <select id="store" className="select cashier-input" required value={storePick} onChange={(e) => setStorePick(e.target.value)}>
                <option value="">Select till store…</option>
                {stores.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
              </select>
            )}
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn success redeem-btn" type="submit">
            CONFIRM REDEMPTION
          </button>
        </form>
      )}
      <p style={{ textAlign: 'center' }}><Link to="/cashier/scan">SCAN ANOTHER</Link></p>
    </div>
  );
}
