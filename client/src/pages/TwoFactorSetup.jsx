import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import api from '../services/api.js';

// Mandatory 2FA enrollment: reached from login when the admin requires staff
// 2FA and this account has none yet. The challenge token (5 min) authorises
// only these two calls — never a session.
export default function TwoFactorSetup() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const challengeToken = state?.challengeToken || '';
  const [bundle, setBundle] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!challengeToken) return;
    api.post('/auth/2fa/enroll', { challengeToken })
      .then(({ data }) => setBundle(data))
      .catch((err) => setError(err.response?.data?.error || 'Could not start enrollment. Sign in again.'));
  }, [challengeToken]);

  const activate = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post('/auth/2fa/activate', { challengeToken, token: code.replace(/\D/g, '') });
      localStorage.setItem('sw_token', data.token);
      localStorage.setItem('sw_user', JSON.stringify(data.user));
      const home = data.user.role === 'CASHIER' ? '/cashier' : '/';
      navigate(home, { replace: true });
      window.location.reload();
    } catch (err) {
      setError(err.response?.data?.error || 'Activation failed.');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  if (!challengeToken) {
    return (
      <div className="auth-wrap">
        <div className="card auth-card error-state">
          <p className="error">This page needs a fresh sign-in first.</p>
          <Link to="/login">Go to login</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1 className="auth-title">Set Up 2FA</h1>
        <p className="muted auth-subtitle">Your organisation requires two-factor authentication. Scan with any authenticator app (Google/Microsoft Authy, 1Password…), then confirm.</p>
        {error && <p className="error">{error}</p>}
        {!bundle ? (
          <p className="muted" style={{ textAlign: 'center' }}>Preparing your secret…</p>
        ) : (
          <>
            <div style={{ textAlign: 'center' }}>
              <img src={bundle.qrCode} alt="2FA setup QR code" width="220" height="220" />
            </div>
            <p className="muted small" style={{ textAlign: 'center', wordBreak: 'break-all' }}>Manual key: <strong>{bundle.manualKey}</strong></p>
            <form onSubmit={activate}>
              <div className="field">
                <label htmlFor="code">6-digit code from the app</label>
                <input id="code" className="input cashier-input" type="text" inputMode="numeric" autoComplete="one-time-code"
                  minLength={6} maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))} required autoFocus />
              </div>
              <button className="btn" type="submit" disabled={busy} style={{ width: '100%' }}>
                {busy ? 'Activating…' : 'Confirm & Sign in'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
