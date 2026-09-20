import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import { useVoucher } from '../hooks/useVouchers.js';
import { formatMWK } from '../utils/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import PrintVoucher from '../components/PrintVoucher.jsx';
import DeliveryPanel from '../components/DeliveryPanel.jsx';
import GiftCardReload from '../components/GiftCardReload.jsx';

// Destructive actions always require explicit confirmation.
function Confirm({ action, onConfirm, onCancel, busy }) {
  return (
    <div className="confirm-box">
      <p>Are you sure you want to <strong>{action}</strong> this voucher?</p>
      <div className="confirm-actions">
        <button className="btn secondary" onClick={onCancel} disabled={busy}>No, keep it</button>
        <button className="btn danger" onClick={onConfirm} disabled={busy}>
          {busy ? 'Working…' : `Yes, ${action}`}
        </button>
      </div>
    </div>
  );
}

export default function VoucherDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const { data, loading, error, retry } = useVoucher(id);
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [history, setHistory] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get(`/redemptions/voucher/${id}`)
      .then(({ data }) => {
        if (!cancelled) setHistory(data);
      })
      .catch(() => {
        if (!cancelled) setHistory({ items: [], error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [id, data]);

  const runAction = async (action) => {
    setBusy(true);
    setActionError('');
    try {
      await api.post(`/vouchers/${id}/${action}`);
      setConfirming(null);
      retry();
    } catch (err) {
      setActionError(err.response?.data?.error || `Failed to ${action} voucher`);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="container wide"><div className="card"><p className="muted">Loading voucher…</p></div></div>;
  if (error) {
    return (
      <div className="container wide">
        <div className="card error-state">
          <p className="error">Could not load voucher: {error}</p>
          <button className="btn" onClick={retry}>Retry</button>
        </div>
      </div>
    );
  }

  const { voucher, qrCode } = data;
  const canSuspend = isAdmin && ['ACTIVE', 'PARTIALLY_REDEEMED'].includes(voucher.status);
  const canCancel = isAdmin && !['FULLY_REDEEMED', 'EXPIRED', 'CANCELLED'].includes(voucher.status);
  const canReactivate = isAdmin && voucher.status === 'SUSPENDED';
  const canNotify = user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const canReload = canNotify && voucher.type === 'GIFT_CARD' &&
    ['ACTIVE', 'PARTIALLY_REDEEMED', 'FULLY_REDEEMED'].includes(voucher.status);

  return (
    <div className="container wide">
      <p className="no-print"><Link to="/vouchers">← Back to vouchers</Link></p>
      <div className="page-head no-print">
        <h1>{voucher.code}</h1>
        <div className="actions">
          <button className="btn secondary" onClick={() => window.print()}>Print Voucher</button>
          {canSuspend && <button className="btn secondary" onClick={() => setConfirming('suspend')}>Suspend</button>}
          {canReactivate && <button className="btn success" onClick={() => setConfirming('reactivate')}>Reactivate</button>}
          {canCancel && <button className="btn danger" onClick={() => setConfirming('cancel')}>Cancel</button>}
        </div>
      </div>

      {actionError && <p className="error no-print">{actionError}</p>}
      {confirming && (
        <div className="no-print">
          <Confirm action={confirming} busy={busy} onCancel={() => setConfirming(null)} onConfirm={() => runAction(confirming)} />
        </div>
      )}

      <div className="grid-2">
        <div className="card">
          <h2>Voucher Details</h2>
          <dl className="details">
            <div><dt>Status</dt><dd><span className={`badge status-${voucher.status}`}>{voucher.status}</span></dd></div>
            <div><dt>Original Value</dt><dd>{formatMWK(voucher.originalValue)}</dd></div>
            <div><dt>Remaining Balance</dt><dd>{formatMWK(voucher.remainingBalance)}</dd></div>
            <div><dt>Total Redeemed</dt><dd>{formatMWK(voucher.totalRedeemed)}</dd></div>
            <div><dt>Type</dt><dd>{voucher.type}</dd></div>
            <div><dt>Issue Date</dt><dd>{new Date(voucher.issueDate).toLocaleDateString('en-GB')}</dd></div>
            <div><dt>Expiry Date</dt><dd>{new Date(voucher.expiryDate).toLocaleDateString('en-GB')}</dd></div>
            <div><dt>Customer</dt><dd>{voucher.customer ? `${voucher.customer.name}${voucher.customer.phone ? ` · ${voucher.customer.phone}` : ''}` : '—'}</dd></div>
            <div><dt>Campaign</dt><dd>{voucher.campaign?.name ?? '—'}</dd></div>
            <div><dt>Valid Stores</dt><dd>{voucher.validStores?.length ? voucher.validStores.map((s) => s.name).join(', ') : 'All stores'}</dd></div>
            <div><dt>Notes</dt><dd>{voucher.restrictions?.notes || '—'}</dd></div>
            <div><dt>Created By</dt><dd>{voucher.createdBy ? `${voucher.createdBy.name} (${voucher.createdBy.email})` : '—'}</dd></div>
          </dl>
        </div>
        <div className="card qr-card no-print">
          <h2>QR Code</h2>
          <img src={qrCode} alt={`QR code for voucher ${voucher.code}`} width="256" height="256" />
          <p className="muted small">Encodes the voucher code only — no value or customer data.</p>
        </div>
      </div>

      <div className="card">
        <h2>Redemption History{history && !history.error ? ` (${history.items.length})` : ''}</h2>
        {!history && <p className="muted">Loading history…</p>}
        {history?.error && <p className="muted">History unavailable.</p>}
        {history && !history.error && history.items.length === 0 && (
          <p className="muted">No redemptions recorded for this voucher.</p>
        )}
        {history && !history.error && history.items.length > 0 && (
          <table className="table">
            <thead>
              <tr><th>Reference</th><th>Amount</th><th>Balance After</th><th>Store</th><th>Cashier</th><th>POS Ref</th><th>Date</th></tr>
            </thead>
            <tbody>
              {history.items.map((r) => (
                <tr key={r.id}>
                  <td>{r.redemptionReference}</td>
                  <td>{formatMWK(r.amountRedeemed)}</td>
                  <td>{formatMWK(r.newBalance)}</td>
                  <td>{r.store?.name ?? '—'}</td>
                  <td>{r.cashier?.name ?? '—'}</td>
                  <td>{r.posTransactionReference}</td>
                  <td>{new Date(r.redeemedAt).toLocaleString('en-GB')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {canReload && <GiftCardReload voucherId={id} onReloaded={retry} />}
      <DeliveryPanel voucherId={id} voucherCode={voucher.code} canNotify={canNotify} />

      <PrintVoucher voucher={voucher} qrCode={qrCode} />
    </div>
  );
}
