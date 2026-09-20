import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatMWK } from '../utils/format.js';

export default function Customers() {
  const { user } = useAuth();
  const canManage = user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/customers${applied ? `?q=${encodeURIComponent(applied)}` : ''}`);
      setItems(data.customers ?? []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, [applied]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      await api.post('/customers', {
        name: form.name,
        phone: form.phone || null,
        email: form.email || null,
        notes: form.notes,
      });
      setForm({ name: '', phone: '', email: '', notes: '' });
      setShowNew(false);
      load();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to create customer');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container wide">
      <div className="page-head">
        <h1>Customers</h1>
        {canManage && <button className="btn" onClick={() => setShowNew((s) => !s)}>New Customer</button>}
      </div>

      {showNew && (
        <form className="card" onSubmit={create}>
          <h2>New Customer</h2>
          <div className="field">
            <label>Name<input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          </div>
          <div className="field" style={{ display: 'flex', gap: 10 }}>
            <label style={{ flex: 1 }}>Phone<input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
            <label style={{ flex: 1 }}>Email<input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          </div>
          <div className="field">
            <label>Notes<textarea className="input" rows="2" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          </div>
          {formError && <p className="error">{formError}</p>}
          <button className="btn" type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create (issues wallet code)'}</button>
        </form>
      )}

      <form className="card filters-bar" onSubmit={(e) => { e.preventDefault(); setApplied(q); }}>
        <input className="input" placeholder="Search name…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn" type="submit">Search</button>
      </form>

      {loading && <div className="card"><p className="muted">Loading customers…</p></div>}
      {!loading && error && (
        <div className="card error-state">
          <p className="error">{error}</p>
          <button className="btn" onClick={load}>Retry</button>
        </div>
      )}
      {!loading && !error && (
        <div className="card">
          {items.length === 0 ? (
            <p className="muted">No customers found.</p>
          ) : (
            <table className="table">
              <thead><tr><th>Name</th><th>Phone</th><th>Wallet Code</th><th>Balance</th><th></th></tr></thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c._id}>
                    <td><strong>{c.name}</strong></td>
                    <td>{c.phone || '—'}</td>
                    <td>{c.walletCode || '—'}</td>
                    <td>{formatMWK(c.walletBalance)}</td>
                    <td><Link to={`/customers/${c._id}`}>View</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
