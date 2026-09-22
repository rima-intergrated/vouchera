import { useCallback, useEffect, useState } from 'react';
import api from '../services/api.js';

const ROLES = ['ADMIN', 'MANAGER', 'CASHIER', 'AUDITOR', 'CUSTOMER'];

// ADMIN-only user administration: create, role/store/active edits, password resets.
// Self-demotion and self-deactivation are refused server-side.
export default function Users() {
  const [users, setUsers] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'CASHIER', store: '' });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editMsg, setEditMsg] = useState({ kind: '', text: '' });
  const [invite, setInvite] = useState(null);

  const reinvite = async (u) => {
    setEditMsg({ kind: '', text: '' });
    try {
      const { data } = await api.post(`/auth/users/${u.id}/reinvite`);
      setInvite({ name: u.name, email: u.email, invite: data.invite });
    } catch (err) {
      setEditMsg({ kind: 'error', text: err.response?.data?.error || 'Reinvite failed.' });
    }
  };

  const reset2fa = async (u) => {
    if (!window.confirm(`Reset 2FA for ${u.name}? They will sign in with password only until re-enrolling.`)) return;
    setEditMsg({ kind: '', text: '' });
    try {
      await api.post(`/auth/users/${u.id}/2fa/reset`);
      setEditMsg({ kind: 'ok', text: `2FA reset for ${u.name}.` });
      load();
    } catch (err) {
      setEditMsg({ kind: 'error', text: err.response?.data?.error || '2FA reset failed.' });
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [{ data: u }, { data: s }] = await Promise.all([
        api.get('/auth/users'),
        api.get('/stores'),
      ]);
      setUsers(u.users ?? []);
      setStores(s.stores ?? []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load users');
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
      const { data } = await api.post('/auth/users', {
        name: form.name,
        email: form.email,
        // Blank password = invite onboarding (user sets their own via link).
        ...(form.password ? { password: form.password } : {}),
        role: form.role,
        ...(form.store ? { store: form.store } : {}),
      });
      setForm({ name: '', email: '', password: '', role: 'CASHIER', store: '' });
      setShowNew(false);
      if (data.invite) {
        setInvite({ name: data.user.name, email: data.user.email, invite: data.invite });
      }
      load();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to create user');
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (id, patch) => {
    setEditMsg({ kind: '', text: '' });
    try {
      const { data } = await api.patch(`/auth/users/${id}`, patch);
      setUsers((list) => list.map((u) => (u.id === id ? data.user : u)));
      setEditing(null);
      setEditMsg({ kind: 'ok', text: 'Saved.' });
    } catch (err) {
      setEditMsg({ kind: 'error', text: err.response?.data?.error || 'Update failed.' });
    }
  };

  const storeName = (u) => u.store?.name ?? '—';

  return (
    <div className="container wide">
      <div className="page-head">
        <h1>Users</h1>
        <button className="btn" onClick={() => setShowNew((s) => !s)}>New User</button>
      </div>
      {editMsg.text && <p className={editMsg.kind === 'error' ? 'error' : 'muted'}>{editMsg.text}</p>}
      {invite && <InvitePanel name={invite.name} email={invite.email} invite={invite.invite} onClose={() => setInvite(null)} />}

      {showNew && (
        <form className="card" onSubmit={create}>
          <h2>New User</h2>
          <div className="field" style={{ display: 'flex', gap: 10 }}>
            <label style={{ flex: 1 }}>Name<input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label style={{ flex: 1 }}>Email<input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          </div>
          <div className="field" style={{ display: 'flex', gap: 10 }}>
            <label style={{ flex: 1 }}>Password (blank = send invite)<input className="input" type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
            <label style={{ flex: 1 }}>Role
              <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label style={{ flex: 1 }}>Store
              <select className="select" value={form.store} onChange={(e) => setForm({ ...form, store: e.target.value })}>
                <option value="">—</option>
                {stores.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
              </select>
            </label>
          </div>
          {formError && <p className="error">{formError}</p>}
          <button className="btn" type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create User'}</button>
        </form>
      )}

      {loading && <div className="card"><p className="muted">Loading users…</p></div>}
      {!loading && error && (
        <div className="card error-state">
          <p className="error">{error}</p>
          <button className="btn" onClick={load}>Retry</button>
        </div>
      )}
      {!loading && !error && (
        <div className="card">
          <table className="table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Store</th><th>Status</th><th>2FA</th><th></th></tr></thead>
            <tbody>
              {users.map((u) => (
                <UserRow key={u.id} user={u} stores={stores} editing={editing === u.id}
                  onEdit={() => setEditing(u.id)} onCancel={() => setEditing(null)} onSave={saveEdit} onReinvite={() => reinvite(u)} onReset2fa={() => reset2fa(u)} storeName={storeName(u)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function UserRow({ user, stores, editing, onEdit, onCancel, onSave, onReinvite, onReset2fa, storeName }) {
  const [role, setRole] = useState(user.role);
  const [store, setStore] = useState(user.store?._id ?? '');
  const [active, setActive] = useState(user.isActive);
  const [password, setPassword] = useState('');

  if (!editing) {
    return (
      <tr>
        <td><strong>{user.name}</strong></td>
        <td>{user.email}</td>
        <td>{user.role}</td>
        <td>{storeName}</td>
        <td>{user.isActive ? 'Active' : 'Disabled'}{user.invitePending ? ' · Invite pending' : ''}</td>
        <td>{['ADMIN', 'MANAGER'].includes(user.role) ? (user.totpEnabled ? 'On' : 'Off') : '—'}</td>
        <td>
          <div className="actions">
            <button className="btn secondary" onClick={onEdit}>Edit</button>
            {user.invitePending && <button className="btn secondary" onClick={onReinvite}>Resend Invite</button>}
            {['ADMIN', 'MANAGER'].includes(user.role) && user.totpEnabled && (
              <button className="btn secondary" onClick={onReset2fa}>Reset 2FA</button>
            )}
          </div>
        </td>
      </tr>
    );
  }

  const patch = { role, store: store || null, isActive: active, ...(password ? { password } : {}) };
  return (
    <tr>
      <td>{user.name}</td>
      <td>{user.email}</td>
      <td>
        <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </td>
      <td>
        <select className="select" value={store} onChange={(e) => setStore(e.target.value)}>
          <option value="">—</option>
          {stores.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
        </select>
      </td>
      <td>
        <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label>
        <input className="input" type="password" placeholder="New password (optional)" minLength={8}
          value={password} onChange={(e) => setPassword(e.target.value)} style={{ marginTop: 6 }} />
      </td>
      <td>
        <div className="actions">
          <button className="btn" onClick={() => onSave(user.id, patch)}>Save</button>
          <button className="btn secondary" onClick={onCancel}>Cancel</button>
        </div>
      </td>
    </tr>
  );
}

// Shown after invite creation or resend: the signup link plus manual
// fallbacks (copy, WhatsApp, email) when the automatic email wasn't sent.
function InvitePanel({ name, email, invite, onClose }) {
  const [copied, setCopied] = useState(false);
  const text = `Hi ${name}, your Vouchera account is ready. Set your password within 72 hours: ${invite.link}`;
  const waLink = `https://wa.me/?text=${encodeURIComponent(text)}`;
  const mailLink = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent('Your Vouchera account')}&body=${encodeURIComponent(text)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite.link);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = invite.link;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="card">
      <h2>Signup Invite for {name}</h2>
      <p className="muted small">
        {invite.emailed
          ? `Signup email sent to ${email}.`
          : `Automatic email was NOT sent${invite.emailError ? ` (${invite.emailError})` : ''} — share the link manually.`}
      </p>
      <div className="field">
        <label>Signup link (expires {new Date(invite.expiresAt).toLocaleString('en-GB')})</label>
        <input className="input" readOnly value={invite.link} onFocus={(e) => e.target.select()} />
      </div>
      <div className="actions">
        <button className="btn secondary" onClick={copy}>{copied ? 'Copied!' : 'Copy Link'}</button>
        <a className="btn secondary" href={waLink} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>Share via WhatsApp</a>
        <a className="btn secondary" href={mailLink} style={{ textDecoration: 'none' }}>Share via Email</a>
        <button className="btn secondary" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
