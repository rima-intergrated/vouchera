import { useState } from 'react';
import api from '../services/api.js';
import { formatMWK } from '../utils/format.js';

// Gift-card reload (GIFT_CARD vouchers only): top up the balance against
// verified payment. Every reload is ledger-backed and idempotent.
export default function GiftCardReload({ voucherId, onReloaded }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ kind: '', text: '' });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg({ kind: '', text: '' });
    try {
      const { data } = await api.post(`/vouchers/${voucherId}/reload`, {
        amount: Number(amount),
        method,
        ...(reference.trim() ? { paymentReference: reference.trim() } : {}),
        idempotencyKey: crypto.randomUUID(),
      });
      setMsg({
        kind: 'ok',
        text: data.replayed
          ? 'Already recorded — showing the original reload.'
          : `Reloaded ${formatMWK(data.transaction.amount)}. New balance: ${formatMWK(data.voucher.remainingBalance)}.`,
      });
      setAmount('');
      setReference('');
      onReloaded?.();
    } catch (err) {
      setMsg({ kind: 'error', text: err.response?.data?.error || 'Reload failed.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card no-print">
      <h2>Reload Gift Card</h2>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="reload-amount">Reload Amount (MWK)</label>
          <input id="reload-amount" className="input" type="number" min="0.01" step="0.01" required
            value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="reload-method">Payment Method</label>
          <select id="reload-method" className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="CASH">Cash (verified at till)</option>
            <option value="TRANSFER">Money transfer (reference required)</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="reload-ref">Payment Reference{method === 'TRANSFER' ? ' (required)' : ''}</label>
          <input id="reload-ref" className="input" autoComplete="off" value={reference}
            onChange={(e) => setReference(e.target.value)} required={method === 'TRANSFER'} />
        </div>
        {msg.text && <p className={msg.kind === 'error' ? 'error' : 'muted'}>{msg.text}</p>}
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Processing…' : 'Reload Card'}
        </button>
      </form>
    </div>
  );
}
