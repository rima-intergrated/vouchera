import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { formatMWK } from '../utils/format.js';

export default function CampaignDetails() {
  const { id } = useParams();
  const { user } = useAuth();
  const canManage = user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const [data, setData] = useState(null);
  const [vouchers, setVouchers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [expiry, setExpiry] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [{ data: c }, { data: v }] = await Promise.all([
        api.get(`/campaigns/${id}`),
        api.get(`/campaigns/${id}/vouchers?limit=20`),
      ]);
      setData(c);
      setVouchers(v.items ?? []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load campaign');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (action, body) => {
    setBusy(true);
    setActionError('');
    try {
      await api.post(`/campaigns/${id}/${action}`, body ?? {});
      await load();
    } catch (err) {
      setActionError(err.response?.data?.error || `Failed to ${action}`);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="container wide"><div className="card"><p className="muted">Loading campaign…</p></div></div>;
  if (error) {
    return (
      <div className="container wide">
        <div className="card error-state">
          <p className="error">{error}</p>
          <button className="btn" onClick={load}>Retry</button>
        </div>
      </div>
    );
  }

  const { campaign, stats } = data;
  const remaining = campaign.voucherQuantity - campaign.generatedCount;

  return (
    <div className="container wide">
      <p><Link to="/campaigns">← Back to campaigns</Link></p>
      <div className="page-head">
        <h1>{campaign.name} <span className={`badge status-${campaign.status}`}>{campaign.status}</span></h1>
        <div className="actions">
          {canManage && campaign.status !== 'ENDED' && <Link className="btn secondary" to={`/campaigns/${id}/edit`}>Edit</Link>}
          {canManage && campaign.status === 'DRAFT' && <button className="btn success" disabled={busy} onClick={() => act('activate')}>Activate</button>}
          {canManage && campaign.status === 'ACTIVE' && <button className="btn secondary" disabled={busy} onClick={() => act('pause')}>Pause</button>}
          {canManage && campaign.status === 'PAUSED' && <button className="btn success" disabled={busy} onClick={() => act('activate')}>Resume</button>}
          {canManage && (campaign.status === 'ACTIVE' || campaign.status === 'PAUSED') && (
            <button className="btn danger" disabled={busy} onClick={() => { if (window.confirm('End this campaign? This cannot be undone.')) act('end'); }}>End</button>
          )}
        </div>
      </div>
      {actionError && <p className="error">{actionError}</p>}

      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Vouchers Issued</div><div className="stat-value">{stats.issued}</div></div>
        <div className="stat-card"><div className="stat-label">Vouchers Redeemed</div><div className="stat-value">{stats.redemptions}</div></div>
        <div className="stat-card"><div className="stat-label">Total Value Issued</div><div className="stat-value" style={{ fontSize: 22 }}>{formatMWK(stats.issuedValue)}</div></div>
        <div className="stat-card"><div className="stat-label">Total Value Redeemed</div><div className="stat-value" style={{ fontSize: 22 }}>{formatMWK(stats.redeemedValue)}</div></div>
        <div className="stat-card"><div className="stat-label">Outstanding Value</div><div className="stat-value" style={{ fontSize: 22 }}>{formatMWK(stats.outstanding)}</div></div>
        <div className="stat-card"><div className="stat-label">Redemption Rate</div><div className="stat-value">{stats.redemptionRate}%</div></div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Campaign Details</h2>
          <dl className="details">
            <div><dt>Code</dt><dd>{campaign.code}</dd></div>
            <div><dt>Description</dt><dd>{campaign.description || '—'}</dd></div>
            <div><dt>Period</dt><dd>{campaign.startsAt?.slice(0, 10) ?? '—'} → {campaign.endsAt?.slice(0, 10) ?? '—'}</dd></div>
            <div><dt>Voucher Type</dt><dd>{campaign.voucherType}</dd></div>
            <div><dt>Voucher Value</dt><dd>{formatMWK(campaign.voucherValue)}</dd></div>
            <div><dt>Quantity</dt><dd>{campaign.voucherQuantity} ({campaign.generatedCount} generated)</dd></div>
            <div><dt>Eligible Stores</dt><dd>{campaign.eligibleStores?.length ? campaign.eligibleStores.map((s) => s.name).join(', ') : 'All Shopwise stores'}</dd></div>
            <div><dt>Terms</dt><dd>{campaign.terms || '—'}</dd></div>
          </dl>
        </div>
        <div className="card">
          <h2>Generate Vouchers</h2>
          {!canManage ? (
            <p className="muted">Voucher generation is restricted to admins and managers.</p>
          ) : campaign.status !== 'ACTIVE' ? (
            <p className="muted">Activate the campaign to generate vouchers.</p>
          ) : remaining <= 0 ? (
            <p className="muted">Quantity fully generated ({campaign.generatedCount}/{campaign.voucherQuantity}).</p>
          ) : (
            <>
              <p>Generate the remaining <strong>{remaining}</strong> × {formatMWK(campaign.voucherValue)} vouchers.</p>
              <div className="field">
                <label>Voucher expiry (defaults to campaign end date)</label>
                <input type="date" className="input" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
              </div>
              <button className="btn" disabled={busy} onClick={() => act('generate', expiry ? { expiryDate: expiry } : {})}>
                {busy ? 'Generating…' : `Generate ${remaining} Vouchers`}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Campaign Vouchers</h2>
        {vouchers.length === 0 ? (
          <p className="muted">No vouchers generated yet.</p>
        ) : (
          <table className="table">
            <thead><tr><th>Code</th><th>Value</th><th>Balance</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {vouchers.map((v) => (
                <tr key={v.id}>
                  <td><strong>{v.code}</strong></td>
                  <td>{formatMWK(v.originalValue)}</td>
                  <td>{formatMWK(v.remainingBalance)}</td>
                  <td><span className={`badge status-${v.status}`}>{v.status}</span></td>
                  <td><Link to={`/vouchers/${v.id}`}>View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
