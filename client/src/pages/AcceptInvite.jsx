import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../services/api.js';

// Public signup-link acceptance: no login required, token in the URL.
export default function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post('/auth/accept-invite', { token, password });
      localStorage.setItem('sw_token', data.token);
      localStorage.setItem('sw_user', JSON.stringify(data.user));
      window.location.href = data.user.role === 'CASHIER' ? '/cashier' : data.user.role === 'CUSTOMER' ? '/portal' : '/';
    } catch (err) {
      setError(err.response?.data?.error || 'Could not accept this invite.');
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <div className="auth-wrap">
        <div className="card auth-card error-state">
          <p className="error">This signup link is missing its token.</p>
          <Link to="/login">Go to login</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1>Set Your Password</h1>
        <p className="muted">Choose a password to activate your Vouchera account.</p>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="pw">New password (min 8 characters)</label>
            <input id="pw" className="input" type="password" autoComplete="new-password"
              value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          </div>
          <div className="field">
            <label htmlFor="pw2">Confirm password</label>
            <input id="pw2" className="input" type="password" autoComplete="new-password"
              value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn" type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Activating…' : 'Activate Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
