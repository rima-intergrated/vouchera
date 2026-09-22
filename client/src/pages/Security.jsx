import { useState } from 'react';
import api from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';

// Self-service 2FA management for ADMIN/MANAGER: status, voluntary setup,
// disable (possession-proving), plus recovery note for lost authenticators.
export default function Security() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(!!user?.totpEnabled);
  const [bundle, setBundle] = useState(null);
  const [code, setCode] = useState('');
  const [disabling, setDisabling] = useState(false);
  const [msg, setMsg] = useState({ kind: '', text: '' });
  const [busy, setBusy] = useState(false);

  const syncUser = (patch) => {
    const next = { ...user, ...patch };
    localStorage.setItem('sw_user', JSON.stringify(next));
    window.location.reload();
  };

  const startSetup = async () => {
    setMsg({ kind: '', text: '' });
    setBusy(true);
    try {
      const { data } = await api.post('/auth/2fa/setup');
      setBundle(data);
      setEnabled(data.enabled);
    } catch (err) {
      setMsg({ kind: 'error', text: err.response?.data?.error || 'Setup failed.' });
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (path) => {
    setMsg({ kind: '', text: '' });
    setBusy(true);
    try {
      const { data } = await api.post(path, { token: code.replace(/\D/g, '') });
      setBundle(null);
      setCode('');
      setDisabling(false);
      setMsg({ kind: 'ok', text: path.endsWith('enable') ? 'Two-factor authentication is ON.' : 'Two-factor authentication is OFF.' });
      syncUser({ totpEnabled: data.enabled });
    } catch (err) {
      setMsg({ kind: 'error', text: err.response?.data?.error || 'Wrong code — try again.' });
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container wide">
      <div className="page-head"><h1>Security</h1></div>
      {msg.text && <p className={msg.kind === 'error' ? 'error' : 'muted'}>{msg.text}</p>}
      <div className="card">
        <h2>Two-factor authentication</h2>
        <p className="muted small">
          Status: <strong>{enabled ? 'ON — logins need your authenticator code' : 'OFF'}</strong>.
          Lost your authenticator? Ask another admin to reset your 2FA from Users.
        </p>
        {!enabled && !bundle && (
          <button className="btn" disabled={busy} onClick={startSetup}>Set up 2FA</button>
        )}
        {bundle && !enabled && (
          <>
            <div style={{ textAlign: 'center' }}>
              <img src={bundle.qrCode} alt="2FA setup QR code" width="220" height="220" />
            </div>
            <p className="muted small" style={{ textAlign: 'center', wordBreak: 'break-all' }}>Manual key: <strong>{bundle.manualKey}</strong></p>
            <div className="field">
              <label htmlFor="code">6-digit code from the app</label>
              <input id="code" className="input cashier-input" type="text" inputMode="numeric" autoComplete="one-time-code"
                minLength={6} maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))} />
            </div>
            <button className="btn" disabled={busy} onClick={() => confirm('/auth/2fa/enable')} style={{ width: '100%' }}>
              {busy ? 'Confirming…' : 'Confirm & Turn On'}
            </button>
          </>
        )}
        {enabled && !disabling && (
          <button className="btn secondary" onClick={() => setDisabling(true)}>Turn off 2FA</button>
        )}
        {enabled && disabling && (
          <>
            <div className="field">
              <label htmlFor="code2">Current code (proves it is really you)</label>
              <input id="code2" className="input cashier-input" type="text" inputMode="numeric" autoComplete="one-time-code"
                minLength={6} maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn secondary" onClick={() => { setDisabling(false); setCode(''); }}>Cancel</button>
              <button className="btn" disabled={busy} onClick={() => confirm('/auth/2fa/disable')}>Confirm Turn Off</button>
            </div>
          </>
        )}
      </div>
      <div className="card">
        <h2>Session safety</h2>
        <p className="muted small">
          Till (cashier) sessions time out per <strong>security.cashierSessionMinutes</strong> in Settings.
          Always sign out on shared devices; wrong till PINs never affect your login.
        </p>
      </div>
    </div>
  );
}
