import { useCallback, useEffect, useState } from 'react';
import api from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';

// Store administration. Deactivating hides a store from selectors and blocks
// redemptions there, without deleting history.
export default function Stores() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', location: '' });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editMsg, setEditMsg] = useState({ kind: '', text: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/stores');
      setStores(data.stores ?? []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load stores');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      await api.post('/stores', { ...form, code: form.code.toUpperCase() });
      setForm({ name: '', code: '', location: '' });
      setShowNew(false);
      load();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to create store');
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (id, patch) => {
    setEditMsg({ kind: '', text: '' });
    try {
      const { data } = await api.patch(`/stores/${id}`, patch);
      setStores((list) => list.map((s) => (s._id === id ? data.store : s)));
      setEditing(null);
    } catch (err) {
      setEditMsg({ kind: 'error', text: err.response?.data?.error || 'Update failed.' });
    }
  };

  return (
    <div className="container wide">
      <div className="page-head">
        <h1>Stores</h1>
        {isAdmin && <button className="btn" onClick={() => setShowNew((s) => !s)}>New Store</button>}
      </div>
      {editMsg.text && <p className="error">{editMsg.text}</p>}

      {showNew && isAdmin && (
        <form className="card" onSubmit={create}>
          <h2>New Store</h2>
          <div className="field" style={{ display: 'flex', gap: 10 }}>
            <label style={{ flex: 2 }}>Name<input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label style={{ flex: 1 }}>Code<input className="input" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} /></label>
            <label style={{ flex: 2 }}>Location<input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
          </div>
          {formError && <p className="error">{formError}</p>}
          <button className="btn" type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create Store'}</button>
        </form>
      )}

      {loading && <div className="card"><p className="muted">Loading stores…</p></div>}
      {!loading && error && (
        <div className="card error-state">
          <p className="error">{error}</p>
          <button className="btn" onClick={load}>Retry</button>
        </div>
      )}
      {!loading && !error && (
        <div className="card">
          <table className="table">
            <thead><tr><th>Name</th><th>Code</th><th>Location</th><th>Status</th>{isAdmin && <th></th>}</tr></thead>
            <tbody>
              {stores.map((s) => (
                <StoreRow key={s._id} store={s} isAdmin={isAdmin} editing={editing === s._id}
                  onEdit={() => setEditing(s._id)} onCancel={() => setEditing(null)} onSave={saveEdit} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StoreRow({ store, isAdmin, editing, onEdit, onCancel, onSave }) {
  const [name, setName] = useState(store.name);
  const [location, setLocation] = useState(store.location ?? '');
  const [active, setActive] = useState(store.isActive);

  if (!editing) {
    return (
      <tr>
        <td><strong>{store.name}</strong></td>
        <td>{store.code}</td>
        <td>{store.location || '—'}</td>
        <td>{store.isActive ? 'Active' : 'Inactive'}</td>
        {isAdmin && <td><button className="btn secondary" onClick={onEdit}>Edit</button></td>}
      </tr>
    );
  }
  return (
    <tr>
      <td><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></td>
      <td>{store.code}</td>
      <td><input className="input" value={location} onChange={(e) => setLocation(e.target.value)} /></td>
      <td><label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label></td>
      <td>
        <div className="actions">
          <button className="btn" onClick={() => onSave(store._id, { name, location, isActive: active })}>Save</button>
          <button className="btn secondary" onClick={onCancel}>Cancel</button>
        </div>
      </td>
    </tr>
  );
}
