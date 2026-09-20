import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api.js';

// Public customer self-registration. The server force-sets role CUSTOMER —
// staff accounts can only be created by an admin.
export default function Register() {
  const [form, setForm] = useState({ name: '', phone: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post('/auth/register', {
        name: form.name,
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
        email: form.email,
        password: form.password,
      });
      localStorage.setItem('sw_token', data.token);
      localStorage.setItem('sw_user', JSON.stringify(data.user));
      window.location.href = '/portal';
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1 className="auth-title">Create Account</h1>
        <p className="muted auth-subtitle">Join Vouchera to track your balance and vouchers</p>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="name">Full name</label>
            <input id="name" className="input" autoComplete="name"
              value={form.name} onChange={(e) => set('name', e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="phone">Phone (optional)</label>
            <input id="phone" className="input" autoComplete="tel"
              value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" className="input" type="email" autoComplete="username"
              value={form.email} onChange={(e) => set('email', e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="pw">Password (min 8 characters)</label>
            <input id="pw" className="input" type="password" autoComplete="new-password"
              value={form.password} onChange={(e) => set('password', e.target.value)} required minLength={8} />
          </div>
          <div className="field">
            <label htmlFor="pw2">Confirm password</label>
            <input id="pw2" className="input" type="password" autoComplete="new-password"
              value={form.confirm} onChange={(e) => set('confirm', e.target.value)} required minLength={8} />
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn" type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Creating…' : 'Create Account'}
          </button>
        </form>
        <p style={{ textAlign: 'center' }}>Already have an account? <Link to="/login">Sign in</Link></p>
      </div>
    </div>
  );
}
