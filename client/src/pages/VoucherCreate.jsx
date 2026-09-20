import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api.js';
import { useLookup } from '../hooks/useVouchers.js';

function defaultExpiry(days = 365) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function VoucherCreate() {
  const navigate = useNavigate();
  const { stores, customers, campaigns, loading: lookupsLoading, error: lookupsError } = useLookup();
  const [form, setForm] = useState({ type: 'FIXED_VALUE', originalValue: '', customer: '', campaign: '', validStores: [], expiryDate: defaultExpiry(), notes: '' });
  const expiryTouched = useRef(false);

  // Real settings consumer: the default expiry follows voucher.defaultExpiryDays.
  useEffect(() => {
    api.get('/settings').then(({ data }) => {
      const days = data.settings?.find((s) => s.key === 'voucher.defaultExpiryDays')?.value;
      if (days && !expiryTouched.current) {
        setForm((f) => ({ ...f, expiryDate: defaultExpiry(days) }));
      }
    }).catch(() => {});
  }, []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleStore = (id) =>
    setForm((f) => ({
      ...f,
      validStores: f.validStores.includes(id) ? f.validStores.filter((s) => s !== id) : [...f.validStores, id],
    }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post('/vouchers', {
        type: form.type,
        originalValue: Number(form.originalValue),
        customer: form.customer || null,
        campaign: form.campaign || null,
        validStores: form.validStores,
        expiryDate: form.expiryDate,
        restrictions: { notes: form.notes },
      });
      navigate(`/vouchers/${data.voucher._id}`);
    } catch (err) {
      const details = err.response?.data?.details?.map((d) => d.message).join('; ');
      setError(details || err.response?.data?.error || 'Failed to create voucher');
    } finally {
      setSaving(false);
    }
  };

  if (lookupsLoading) return <div className="container wide"><div className="card"><p className="muted">Loading form…</p></div></div>;
  if (lookupsError) return <div className="container wide"><div className="card"><p className="error">{lookupsError}</p></div></div>;

  return (
    <div className="container" style={{ maxWidth: 640 }}>
      <p><Link to="/vouchers">← Back to vouchers</Link></p>
      <h1>Create Voucher</h1>
      <form className="card" onSubmit={submit}>
        <div className="field">
          <label htmlFor="type">Voucher Type</label>
          <select id="type" className="select" value={form.type} onChange={(e) => set('type', e.target.value)}>
            <option value="FIXED_VALUE">Fixed value</option>
            <option value="GIFT_CARD">Gift card (reloadable)</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="value">Voucher Value (MWK)</label>
          <input id="value" className="input" type="number" min="1" step="1" required
            value={form.originalValue} onChange={(e) => set('originalValue', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="customer">Customer (optional)</label>
          <select id="customer" className="select" value={form.customer} onChange={(e) => set('customer', e.target.value)}>
            <option value="">— None —</option>
            {customers.map((c) => <option key={c._id} value={c._id}>{c.name}{c.phone ? ` · ${c.phone}` : ''}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="campaign">Campaign (optional)</label>
          <select id="campaign" className="select" value={form.campaign} onChange={(e) => set('campaign', e.target.value)}>
            <option value="">— None —</option>
            {campaigns.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Valid Stores (none selected = all stores)</label>
          <div className="check-grid">
            {stores.map((s) => (
              <label key={s._id} className="check">
                <input type="checkbox" checked={form.validStores.includes(s._id)} onChange={() => toggleStore(s._id)} />
                {s.name}
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="expiry">Expiry Date</label>
          <input id="expiry" className="input" type="date" required value={form.expiryDate} onChange={(e) => { expiryTouched.current = true; set('expiryDate', e.target.value); }} />
        </div>
        <div className="field">
          <label htmlFor="notes">Notes</label>
          <textarea id="notes" className="input" rows="3" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
        {error && <p className="error">{error}</p>}
        <button className="btn" type="submit" disabled={saving} style={{ width: '100%' }}>
          {saving ? 'Creating…' : 'Create Voucher'}
        </button>
      </form>
    </div>
  );
}
