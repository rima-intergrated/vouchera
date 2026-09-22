import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api.js';

// Public customer self-registration. The server force-sets role CUSTOMER —
// staff accounts can only be created by an admin.
// Step 2 collects the 4-digit till payment PIN right after signup.
export default function Register() {
  const [step, setStep] = useState('details');
  const [form, setForm] = useState({ name: '', phone: '', email: '', password: '', confirm: '' });
  const [pin, setPin] = useState({ pin: '', confirm: '' });
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
      setStep('pin');
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const submitPin = async (e) => {
    e.preventDefault();
    setError('');
    if (!/^\d{4}$/.test(pin.pin)) {
      setError('PIN must be exactly 4 digits.');
      return;
    }
    if (pin.pin !== pin.confirm) {
      setError('PINs do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/customers/me/pin', { pin: pin.pin });
      window.location.href = '/portal';
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save PIN. You can set it later in the portal.');
    } finally {
      setBusy(false);
    }
  };

  const skipPin = () => {
    window.location.href = '/portal';
  };

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        {step === 'pin' ? (
          <>
            <h1 className="auth-title">Set Payment PIN</h1>
            <p className="muted auth-subtitle">Choose a 4-digit PIN to authorise till payments when your code is scanned</p>
            <form onSubmit={submitPin}>
              <div className="field">
                <label htmlFor="pin">4-digit PIN</label>
                <input id="pin" className="input cashier-input" type="password" inputMode="numeric" minLength={4} maxLength={4} autoComplete="new-password"
                  value={pin.pin} onChange={(e) => setPin({ ...pin, pin: e.target.value.replace(/\D/g, '').slice(0, 4) })} required />
              </div>
              <div className="field">
                <label htmlFor="pin2">Confirm PIN</label>
                <input id="pin2" className="input cashier-input" type="password" inputMode="numeric" minLength={4} maxLength={4} autoComplete="new-password"
                  value={pin.confirm} onChange={(e) => setPin({ ...pin, confirm: e.target.value.replace(/\D/g, '').slice(0, 4) })} required />
              </div>
              {error && <p className="error">{error}</p>}
              <button className="btn" type="submit" disabled={busy} style={{ width: '100%' }}>
                {busy ? 'Saving…' : 'Set PIN'}
              </button>
            </form>
            <p style={{ textAlign: 'center' }}><button className="btn secondary" onClick={skipPin} style={{ width: '100%' }}>Skip for now</button></p>
          </>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
