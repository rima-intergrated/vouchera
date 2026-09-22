import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const { login, verify2fa, loading, error } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const [localError, setLocalError] = useState('');

  const home = (user) => (user.role === 'CASHIER' ? '/cashier' : user.role === 'CUSTOMER' ? '/portal' : '/');

  const onSubmit = async (e) => {
    e.preventDefault();
    setLocalError('');
    try {
      const result = await login(email, password);
      if (result?.requires2fa) {
        if (result.mustEnroll) {
          navigate('/setup-2fa', { state: { challengeToken: result.challengeToken, email } });
        } else {
          setChallenge(result.challengeToken);
        }
        return;
      }
      navigate(home(result), { replace: true });
    } catch {
      // error state handled in context
    }
  };

  const onVerify = async (e) => {
    e.preventDefault();
    setLocalError('');
    try {
      const user = await verify2fa(challenge, code.replace(/\D/g, ''));
      navigate(home(user), { replace: true });
    } catch (err) {
      setLocalError(err.message);
      setCode('');
    }
  };

  if (challenge) {
    return (
      <div className="auth-wrap">
        <div className="card auth-card">
          <h1 className="auth-title">Two-Factor Code</h1>
          <p className="muted auth-subtitle">Enter the 6-digit code from your authenticator app ({email})</p>
          <form onSubmit={onVerify}>
            <div className="field">
              <label htmlFor="code">Authenticator code</label>
              <input id="code" className="input cashier-input" type="text" inputMode="numeric" autoComplete="one-time-code"
                minLength={6} maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))} required autoFocus />
            </div>
            {(localError || error) && <p className="error">{localError || error}</p>}
            <button className="btn" type="submit" disabled={loading} style={{ width: '100%' }}>
              {loading ? 'Verifying…' : 'Verify & Sign in'}
            </button>
          </form>
          <p style={{ textAlign: 'center' }}><button className="btn secondary" onClick={() => { setChallenge(null); setCode(''); }}>Back</button></p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1 className="auth-title">Vouchera</h1>
        <p className="muted auth-subtitle">Sign in to continue</p>
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" className="input" type="email" autoComplete="username"
              value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" className="input" type="password" autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn" type="submit" disabled={loading} style={{ width: '100%' }}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p style={{ textAlign: 'center' }}><Link to="/forgot-password">Forgot password?</Link></p>
        <p style={{ textAlign: 'center' }} className="muted">New customer? <Link to="/register">Create account</Link></p>
      </div>
    </div>
  );
}
