import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api.js';

export default function ForgotPin() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/forgot-pin', { email });
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1 className="auth-title">Reset Payment PIN</h1>
        {done ? (
          <>
            <p className="muted" style={{ textAlign: 'center' }}>
              A PIN reset link has been sent to your email address. It expires in 1 hour.
            </p>
            <p style={{ textAlign: 'center' }}><Link to="/login">Back to sign in</Link></p>
          </>
        ) : (
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="email">Account email</label>
              <input id="email" className="input" type="email" autoComplete="username"
                value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            {error && <p className="error">{error}</p>}
            <button className="btn" type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Sending…' : 'Send PIN Reset Link'}
            </button>
            <p style={{ textAlign: 'center' }}><Link to="/login">Back to sign in</Link></p>
          </form>
        )}
      </div>
    </div>
  );
}
