import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../services/api.js';

const TYPES = ['FIXED_VALUE', 'PERCENTAGE', 'PRODUCT', 'DEPARTMENT', 'CAMPAIGN'];

// Shared create/edit form. Edit mode locks the voucher blueprint once
// vouchers have been generated (enforced again server-side).
export default function CampaignForm() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const [stores, setStores] = useState([]);
  const [form, setForm] = useState({
    name: '', code: '', description: '', startsAt: '', endsAt: '',
    voucherType: 'FIXED_VALUE', voucherValue: '', voucherQuantity: '',
    eligibleStores: [], terms: '',
  });
  const [generatedCount, setGeneratedCount] = useState(0);
  const [status, setStatus] = useState('DRAFT');
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/stores?active=true').then(({ data }) => setStores(data.stores ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!editing) return;
    api.get(`/campaigns/${id}`).then(({ data }) => {
      const c = data.campaign;
      setForm({
        name: c.name, code: c.code, description: c.description ?? '',
        startsAt: c.startsAt ? c.startsAt.slice(0, 10) : '',
        endsAt: c.endsAt ? c.endsAt.slice(0, 10) : '',
        voucherType: c.voucherType, voucherValue: c.voucherValue,
        voucherQuantity: c.voucherQuantity,
        eligibleStores: (c.eligibleStores ?? []).map((s) => s._id),
        terms: c.terms ?? '',
      });
      setGeneratedCount(c.generatedCount ?? 0);
      setStatus(c.status);
    }).catch(() => setError('Failed to load campaign')).finally(() => setLoading(false));
  }, [editing, id]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleStore = (sid) =>
    setForm((f) => ({
      ...f,
      eligibleStores: f.eligibleStores.includes(sid) ? f.eligibleStores.filter((s) => s !== sid) : [...f.eligibleStores, sid],
    }));

  const blueprintLocked = editing && generatedCount > 0;
  const ended = status === 'ENDED';

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const payload = {
      ...form,
      startsAt: form.startsAt || null,
      endsAt: form.endsAt || null,
      voucherValue: form.voucherValue === '' ? 0 : Number(form.voucherValue),
      voucherQuantity: form.voucherQuantity === '' ? 0 : Number(form.voucherQuantity),
    };
    try {
      if (editing) {
        await api.patch(`/campaigns/${id}`, payload);
        navigate(`/campaigns/${id}`);
      } else {
        const { data } = await api.post('/campaigns', payload);
        navigate(`/campaigns/${data.campaign._id}`);
      }
    } catch (err) {
      const details = err.response?.data?.details?.map((d) => d.message).join('; ');
      setError(details || err.response?.data?.error || 'Failed to save campaign');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="container wide"><div className="card"><p className="muted">Loading…</p></div></div>;

  return (
    <div className="container" style={{ maxWidth: 640 }}>
      <p><Link to={editing ? `/campaigns/${id}` : '/campaigns'}>← Back</Link></p>
      <h1>{editing ? 'Edit Campaign' : 'Create Campaign'}</h1>
      {ended && <p className="error">ENDED campaigns cannot be edited.</p>}
      <form className="card" onSubmit={submit}>
        <div className="field">
          <label htmlFor="name">Name</label>
          <input id="name" className="input" required disabled={ended} value={form.name} onChange={(e) => set('name', e.target.value)} />
        </div>
        {!editing && (
          <div className="field">
            <label htmlFor="code">Code</label>
            <input id="code" className="input" required value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} />
          </div>
        )}
        <div className="field">
          <label htmlFor="desc">Description</label>
          <textarea id="desc" className="input" rows="2" disabled={ended} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </div>
        <div className="field" style={{ display: 'flex', gap: 10 }}>
          <label style={{ flex: 1 }}>Start Date<input type="date" className="input" disabled={ended} value={form.startsAt} onChange={(e) => set('startsAt', e.target.value)} /></label>
          <label style={{ flex: 1 }}>End Date<input type="date" className="input" disabled={ended} value={form.endsAt} onChange={(e) => set('endsAt', e.target.value)} /></label>
        </div>
        <div className="field">
          <label htmlFor="vtype">Voucher Type</label>
          <select id="vtype" className="select" disabled={ended || blueprintLocked} value={form.voucherType} onChange={(e) => set('voucherType', e.target.value)}>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="field" style={{ display: 'flex', gap: 10 }}>
          <label style={{ flex: 1 }}>Voucher Value (MWK)<input type="number" min="0" step="0.01" className="input" disabled={ended || blueprintLocked} value={form.voucherValue} onChange={(e) => set('voucherValue', e.target.value)} /></label>
          <label style={{ flex: 1 }}>Voucher Quantity<input type="number" min="0" step="1" className="input" disabled={ended || blueprintLocked} value={form.voucherQuantity} onChange={(e) => set('voucherQuantity', e.target.value)} /></label>
        </div>
        {blueprintLocked && <p className="muted small">Voucher blueprint is locked — {generatedCount} vouchers already generated.</p>}
        <div className="field">
          <label>Eligible Stores (none = all Shopwise stores)</label>
          <div className="check-grid">
            {stores.map((s) => (
              <label key={s._id} className="check">
                <input type="checkbox" disabled={ended} checked={form.eligibleStores.includes(s._id)} onChange={() => toggleStore(s._id)} />
                {s.name}
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="terms">Terms</label>
          <textarea id="terms" className="input" rows="3" disabled={ended} value={form.terms} onChange={(e) => set('terms', e.target.value)} />
        </div>
        {error && <p className="error">{error}</p>}
        {!ended && (
          <button className="btn" type="submit" disabled={saving} style={{ width: '100%' }}>
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Campaign'}
          </button>
        )}
      </form>
    </div>
  );
}
