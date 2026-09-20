import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

// Cashier hub: scan entry point + manual fallback (for denied cameras,
// unsupported browsers, or damaged QR codes) + own history.
export default function Cashier() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');

  const lookup = (e) => {
    e.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (normalized) navigate(`/cashier/voucher/${encodeURIComponent(normalized)}`);
  };

  return (
    <div className="cashier-wrap">
      <h1>VOUCHERA</h1>
      <Link className="btn scan-btn" to="/cashier/scan">SCAN VOUCHER</Link>
      <form className="card" onSubmit={lookup} style={{ marginTop: 16 }}>
        <div className="field">
          <label htmlFor="manual-code">Or enter voucher code manually</label>
          <input
            id="manual-code"
            className="input"
            placeholder="SW-XXXX-XXXX"
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <button className="btn secondary" type="submit" style={{ width: '100%' }}>Look up voucher</button>
      </form>
      <p style={{ textAlign: 'center' }}>
        <Link to="/cashier/history">My redemption history</Link>
      </p>
    </div>
  );
}
