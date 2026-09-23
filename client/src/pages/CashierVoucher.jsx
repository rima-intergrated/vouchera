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
  PIN_NOT_SET: 'This account has no payment PIN yet — the customer must set it in the portal first.',
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
  // Till authorisation: customer types their 4-digit PIN on this device.
  const [pin, setPin] = useState('');
  const [usePoints, setUsePoints] = useState(false);
  const [points, setPoints] = useState('');
  // Split tender: part of the bill paid outside stored value (till cash/VISA).
  const [splitPay, setSplitPay] = useState(false);
  const [bill, setBill] = useState('');
  const [tenderMethod, setTenderMethod] = useState('CASH');
  const [tenderRef, setTenderRef] = useState('');

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
            requiresPin: true,
            pinSet: raw.pinSet,
            loyalty: raw.loyalty,
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
      // Till debits need a PIN on the account — block early with guidance.
      if (data.valid && data.requiresPin && data.pinSet === false) {
        setResult(data);
        setState('invalid');
        setReason('PIN_NOT_SET');
        return;
      }
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
    if (result?.voucher && value > result.voucher.remainingBalance && !usePoints) {
      setError(`Amount exceeds the remaining balance (${formatMWK(result.voucher.remainingBalance)}).`);
      return;
    }
    if (result?.requiresPin && !/^\d{4,6}$/.test(pin)) {
      setError('Ask the customer to enter their payment PIN (4 digits).');
      return;
    }
    if (usePoints) {
      const pts = Math.floor(Number(points) || 0);
      const min = result?.loyalty?.minRedeemPoints ?? 1;
      if (!Number.isFinite(pts) || pts <= 0) {
        setError('Enter the points to redeem.');
        return;
      }
      if (pts < min) {
        setError(`Minimum ${min} points per redemption.`);
        return;
      }
      if (pts > (result?.loyalty?.points ?? 0)) {
        setError(`Only ${result?.loyalty?.points ?? 0} points available.`);
        return;
      }
    }
    if (splitPay) {
      const billNum = Number(bill);
      if (!Number.isFinite(billNum) || billNum <= 0) {
        setError('Enter the full bill total.');
        return;
      }
      const ptsValue = usePoints && points ? Math.min(Math.floor(Number(points)) * (result?.loyalty?.mwkPerPoint ?? 0), value) : 0;
      if (billNum + 0.005 < value - ptsValue) {
        setError(`Bill total must cover the stored-value amount (${formatMWK(value - ptsValue)}).`);
        return;
      }
      if (tenderMethod === 'VISA' && !tenderRef.trim()) {
        setError('Enter the VISA auth code from the card terminal.');
        return;
      }
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
        ...(result?.requiresPin ? { pin } : {}),
        ...(usePoints && points ? { loyaltyPoints: Math.floor(Number(points)) } : {}),
        ...(splitPay ? {
          billTotal: Number(bill),
          tenderMethod,
          ...(tenderRef.trim() ? { tenderReference: tenderRef.trim() } : {}),
        } : {}),
      };
      const { data: raw } = wallet
        ? await api.post('/wallets/debit', { ...payload, walletCode: code })
        : await api.post('/vouchers/redeem', { ...payload, code });
      const data = wallet
        ? {
            replayed: raw.replayed,
            redemption: { ...raw.redemption, source: raw.redemption?.source ?? 'WALLET' },
            voucher: { code: raw.wallet.code, remainingBalance: raw.wallet.remainingBalance },
            loyalty: raw.loyalty,
            earnedPoints: raw.earnedPoints,
          }
        : raw;
      setSuccess(data);
      setConfirming(false);
      setPin('');
      setState('success');
    } catch (err) {
      if (!err.response) {
        setError('Network error — the redemption may not have gone through. Re-scan to check the balance before retrying.');
      } else {
        setError(err.response.data?.error || 'Redemption failed.');
      }
      // A wrong PIN must never linger on screen — customer retries cleanly,
      // and the cashier's session is untouched (stays on this page).
      setPin('');
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
    const src = success.redemption?.source ?? (wallet ? 'WALLET' : 'VOUCHER');
    return (
      <div className="cashier-wrap">
        <div className="card success-card">
          <h1 className="success-title">{src === 'LOYALTY' ? '✓ PAID WITH POINTS' : wallet ? '✓ WALLET DEBITED' : '✓ VOUCHER REDEEMED'}</h1>
          <dl className="cashier-details">
            <div><dt>Amount</dt><dd>{formatMWK(success.redemption.amountRedeemed)}</dd></div>
            {success.redemption.tenderMethod && success.redemption.tenderMethod !== 'NONE' && (
              <>
                <div><dt>Bill Total</dt><dd>{formatMWK(success.redemption.billTotal)}</dd></div>
                <div><dt>{success.redemption.tenderMethod} Tender</dt><dd>{formatMWK(success.redemption.tenderAmount)}{success.redemption.tenderReference ? ` · ${success.redemption.tenderReference}` : ''}</dd></div>
              </>
            )}
            {success.loyalty && (
              <div><dt>Points Used</dt><dd>{success.loyalty.points} pts (−{formatMWK(success.loyalty.discount)})</dd></div>
            )}
            <div><dt>Remaining Balance</dt><dd>{formatMWK(success.voucher.remainingBalance)}</dd></div>
            {success.earnedPoints ? (
              <div><dt>Points Earned</dt><dd>+{success.earnedPoints} pts</dd></div>
            ) : null}
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
  const loyaltyInfo = result.loyalty ?? null;
  const pointsValue = (pts) => (loyaltyInfo ? (Math.floor(Number(pts) || 0) * loyaltyInfo.mwkPerPoint) : 0);
  const activePoints = usePoints ? Math.min(Math.floor(Number(points) || 0), loyaltyInfo?.points ?? 0) : 0;
  const activeDiscount = Math.min(pointsValue(activePoints), confirmAmount);
  const storedPreview = Math.max(0, confirmAmount - activeDiscount);
  const billNum = Number(bill) || 0;
  const tenderPreview = splitPay ? Math.max(0, billNum - storedPreview) : 0;

  return (
    <div className="cashier-wrap">
      <h1>VOUCHERA</h1>
      <div className="card balance-hero">
        <div className="muted">{wallet ? 'Wallet Balance' : 'Voucher Balance'}</div>
        <div className="balance-value">{formatMWK(v.remainingBalance)}</div>
        <div className="muted small">{v.code} · {v.status.replace('_', ' ')}</div>
        {loyaltyInfo && loyaltyInfo.points > 0 && (
          <div className="muted small">Loyalty: {loyaltyInfo.points} pts (≈ {formatMWK(loyaltyInfo.points * loyaltyInfo.mwkPerPoint)})</div>
        )}
      </div>

      <div className="card">
        <dl className="cashier-details">
          <div><dt>Expiry Date</dt><dd>{v.expiryDate ? new Date(v.expiryDate).toLocaleDateString('en-GB') : '—'}</dd></div>
          <div><dt>Customer</dt><dd>{v.customer ? `${v.customer.name}${v.customer.phone ? ` · ${v.customer.phone}` : ''}` : '—'}</dd></div>
          <div><dt>Stores</dt><dd>{v.validStores?.length ? v.validStores.map((s) => s.name).join(', ') : 'All stores'}</dd></div>
          {v.restrictions?.notes && <div><dt>Notes</dt><dd>{v.restrictions.notes}</dd></div>}
          {result?.requiresPin && <div><dt>Authorisation</dt><dd>Customer PIN required</dd></div>}
        </dl>
      </div>

      {confirming ? (
        <div className="card confirm-box">
          <p>You are about to redeem:</p>
          <p className="confirm-amount">{formatMWK(confirmAmount)}</p>
          {activeDiscount > 0 && <p className="muted small">Points discount: −{formatMWK(activeDiscount)} ({activePoints} pts)</p>}
          {splitPay && (
            <p className="muted small">Bill total {formatMWK(billNum)} · {tenderMethod} tender {formatMWK(tenderPreview)}{tenderMethod === 'VISA' ? ` · auth ${tenderRef.trim()}` : ''}</p>
          )}
          <p>{wallet ? 'Wallet balance after debit:' : 'Voucher remaining after redemption:'}</p>
          <p className="confirm-amount">{formatMWK(Math.max(0, v.remainingBalance - storedPreview))}</p>
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
            <input id="amount" className="input cashier-input" type="number" min="0.01" step="0.01" required
              placeholder="K____________" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="posref">POS Transaction Number</label>
            <input id="posref" className="input cashier-input" required autoComplete="off"
              placeholder="______________" value={posRef} onChange={(e) => setPosRef(e.target.value)} />
          </div>
          {loyaltyInfo && loyaltyInfo.points >= (loyaltyInfo.minRedeemPoints ?? 1) && (
            <div className="field">
              <label htmlFor="usepoints" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input id="usepoints" type="checkbox" checked={usePoints}
                  onChange={(e) => { setUsePoints(e.target.checked); if (e.target.checked && !points) setPoints(String(loyaltyInfo.points)); }} />
                Use loyalty points ({loyaltyInfo.points} pts ≈ {formatMWK(loyaltyInfo.points * loyaltyInfo.mwkPerPoint)})
              </label>
              {usePoints && (
                <input id="points" className="input cashier-input" type="number" min={loyaltyInfo.minRedeemPoints} max={loyaltyInfo.points} step="1"
                  placeholder={`Points (min ${loyaltyInfo.minRedeemPoints})`} value={points}
                  onChange={(e) => setPoints(e.target.value)} />
              )}
              {usePoints && !!activeDiscount && (
                <p className="muted small">Discount −{formatMWK(activeDiscount)} · {wallet ? 'wallet charged' : 'voucher charged'} {formatMWK(Math.max(0, confirmAmount - activeDiscount))}</p>
              )}
            </div>
          )}
          {result?.requiresPin && (
            <div className="field">
              <label htmlFor="pin">Customer PIN (4 digits)</label>
              <input id="pin" className="input cashier-input" type="password" inputMode="numeric" minLength={4} maxLength={6} autoComplete="off"
                placeholder="••••" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} required />
              <p className="muted small">Customer enters their PIN on this device to authorise.</p>
            </div>
          )}
          <div className="field">
            <label htmlFor="splitpay" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input id="splitpay" type="checkbox" checked={splitPay} onChange={(e) => setSplitPay(e.target.checked)} />
              Split payment — rest paid by Cash / VISA
            </label>
            {splitPay && (
              <>
                <input id="bill" className="input cashier-input" type="number" min="0.01" step="0.01" required
                  placeholder="Full bill total K____________" value={bill} onChange={(e) => setBill(e.target.value)} style={{ marginTop: 8 }} />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <select className="select cashier-input" value={tenderMethod} onChange={(e) => setTenderMethod(e.target.value)} style={{ flex: 1 }}>
                    <option value="CASH">Cash</option>
                    <option value="VISA">VISA</option>
                  </select>
                  <input id="tenderref" className="input cashier-input" autoComplete="off" style={{ flex: 2 }}
                    placeholder={tenderMethod === 'VISA' ? 'VISA auth code (required)' : 'Tender note (optional)'}
                    value={tenderRef} onChange={(e) => setTenderRef(e.target.value)} />
                </div>
                {!!tenderPreview && (
                  <p className="muted small">{tenderMethod} collects {formatMWK(tenderPreview)} outside stored value.</p>
                )}
              </>
            )}
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
