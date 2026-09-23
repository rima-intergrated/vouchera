import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import { formatMWK } from '../utils/format.js';

// Cashier hub: shift open/close + scan entry point + manual fallback (for
// denied cameras, unsupported browsers, or damaged QR codes) + own history.
export default function Cashier() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [shift, setShift] = useState(null);
  const [shiftLoading, setShiftLoading] = useState(true);
  const [declared, setDeclared] = useState('');
  const [shiftMsg, setShiftMsg] = useState({ kind: '', text: '' });
  const [shiftBusy, setShiftBusy] = useState(false);

  const loadShift = useCallback(async () => {
    setShiftLoading(true);
    try {
      const { data } = await api.get('/shifts/mine?limit=1');
      setShift((data.items ?? []).find((s) => s.status === 'OPEN') ?? null);
    } catch {
      setShift(null);
    } finally {
      setShiftLoading(false);
    }
  }, []);

  useEffect(() => {
    loadShift();
  }, [loadShift]);

  const openShift = async () => {
    setShiftBusy(true);
    setShiftMsg({ kind: '', text: '' });
    try {
      const { data } = await api.post('/shifts/open');
      setShift(data.shift);
    } catch (err) {
      setShiftMsg({ kind: 'error', text: err.response?.data?.error || 'Could not open shift.' });
    } finally {
      setShiftBusy(false);
    }
  };

  const closeShift = async (e) => {
    e.preventDefault();
    setShiftBusy(true);
    setShiftMsg({ kind: '', text: '' });
    try {
      const { data } = await api.post('/shifts/close', { declaredCash: Number(declared) });
      setShift(null);
      setDeclared('');
      const v = data.shift.varianceCash;
      setShiftMsg({
        kind: v === 0 ? 'ok' : 'error',
        text: `Shift closed. Expected ${formatMWK(data.shift.expectedCash)} cash, declared ${formatMWK(data.shift.declaredCash)} — variance ${formatMWK(v)}.`,
      });
      loadShift();
    } catch (err) {
      setShiftMsg({ kind: 'error', text: err.response?.data?.error || 'Could not close shift.' });
    } finally {
      setShiftBusy(false);
    }
  };

  const lookup = (e) => {
    e.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (normalized) navigate(`/cashier/voucher/${encodeURIComponent(normalized)}`);
  };

  return (
    <div className="cashier-wrap">
      <h1>VOUCHERA</h1>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Till Shift</h2>
        {shiftLoading ? (
          <p className="muted">Checking shift…</p>
        ) : shift ? (
          <form onSubmit={closeShift}>
            <p className="muted small">Open since {new Date(shift.openedAt).toLocaleString('en-GB')} · {shift.store?.name ?? ''}</p>
            <div className="field">
              <label htmlFor="declared">Counted cash in drawer (K)</label>
              <input id="declared" className="input cashier-input" type="number" min="0" step="0.01" required
                placeholder="K____________" value={declared} onChange={(e) => setDeclared(e.target.value)} />
            </div>
            {shiftMsg.text && <p className={shiftMsg.kind === 'error' ? 'error' : 'muted'}>{shiftMsg.text}</p>}
            <button className="btn success" type="submit" disabled={shiftBusy} style={{ width: '100%' }}>
              {shiftBusy ? 'Closing…' : 'Close Shift'}
            </button>
          </form>
        ) : (
          <>
            <p className="muted small">No open shift. Open one to start selling — closing compares counted cash to the ledger.</p>
            {shiftMsg.text && <p className={shiftMsg.kind === 'error' ? 'error' : 'muted'}>{shiftMsg.text}</p>}
            <button className="btn secondary" onClick={openShift} disabled={shiftBusy} style={{ width: '100%' }}>
              {shiftBusy ? 'Opening…' : 'Open Shift'}
            </button>
          </>
        )}
      </div>
      <div style={{ height: 12 }} />
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
