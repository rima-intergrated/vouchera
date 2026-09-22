import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../services/api.js';

export default function ResetPin() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!/^\d{4}$/.test(pin)) {
      setError('PIN must be exactly 4 digits.');
      return;
    }
    if (pin !== confirm) {
      setError('PINs do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/reset-pin', { token, pin });
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not reset this PIN.');
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <div className="auth-wrap">
        <div className="card auth-card error-state">
          <p className="error">This reset link is missing its token.</p>
          <Link to="/login">Go to login</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1 className="auth-title">New Payment PIN</h1>
        {done ? (
          <>
            <p className="muted" style={{ textAlign: 'center' }}>Your payment PIN has been reset.</p>
            <p style={{ textAlign: 'center' }}><Link to="/login">Sign in</Link></p>
          </>
        ) : (
          <>
            <p className="muted auth-subtitle">Choose a new 4-digit till payment PIN.</p>
            <form onSubmit={submit}>
              <div className="field">
                <label htmlFor="pin">New PIN (4 digits)</label>
                <input id="pin" className="input cashier-input" type="password" inputMode="numeric" minLength={4} maxLength={4} autoComplete="new-password"
                  value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} required />
              </div>
              <div className="field">
                <label htmlFor="pin2">Confirm PIN</label>
                <input id="pin2" className="input cashier-input" type="password" inputMode="numeric" minLength={4} maxLength={4} autoComplete="new-password"
                  value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))} required />
              </div>
              {error && <p className="error">{error}</p>}
              <button className="btn" type="submit" disabled={busy} style={{ width: '100%' }}>
                {busy ? 'Resetting…' : 'Reset PIN'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
