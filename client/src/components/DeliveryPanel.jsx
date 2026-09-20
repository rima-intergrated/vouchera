import { useEffect, useState } from 'react';
import api from '../services/api.js';

// Delivery panel: download PDF, copy code, and provider-backed channels
// (email/SMS/WhatsApp) via the notification service abstraction.
// Channels without a configured provider are shown disabled — never faked.
export default function DeliveryPanel({ voucherId, voucherCode, canNotify }) {
  const [channels, setChannels] = useState([]);
  const [recipient, setRecipient] = useState('');
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [sending, setSending] = useState(null);
  const [feedback, setFeedback] = useState({ kind: '', text: '' });
  const [deliveries, setDeliveries] = useState([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get('/vouchers/notify-channels').catch(() => ({ data: { channels: [] } })),
      api.get(`/vouchers/${voucherId}/deliveries`).catch(() => ({ data: { items: [] } })),
    ]).then(([{ data: c }, { data: d }]) => {
      if (!cancelled) {
        setChannels(c.channels ?? []);
        setDeliveries(d.items ?? []);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [voucherId]);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(voucherCode);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = voucherCode;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const { data } = await api.get(`/vouchers/${voucherId}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `shopwise-voucher-${voucherCode}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setFeedback({ kind: 'error', text: 'PDF download failed. Try again.' });
    } finally {
      setDownloading(false);
    }
  };

  const send = async (channel) => {
    setSending(channel);
    setFeedback({ kind: '', text: '' });
    try {
      await api.post(`/vouchers/${voucherId}/notify`, { channel, recipient: recipient.trim() });
      setFeedback({ kind: 'ok', text: `${channel} delivery recorded as sent.` });
      const { data } = await api.get(`/vouchers/${voucherId}/deliveries`);
      setDeliveries(data.items ?? []);
    } catch (err) {
      if (!err.response) {
        setFeedback({ kind: 'error', text: 'Network error — delivery status unknown. Check the log below.' });
      } else {
        setFeedback({ kind: 'error', text: err.response.data?.error || 'Delivery failed.' });
        const { data } = await api.get(`/vouchers/${voucherId}/deliveries`).catch(() => ({ data: { items: deliveries } }));
        setDeliveries(data.items ?? []);
      }
    } finally {
      setSending(null);
    }
  };

  return (
    <div className="card no-print">
      <h2>Deliver Voucher</h2>
      <div className="actions" style={{ marginBottom: 12 }}>
        <button className="btn secondary" onClick={downloadPdf} disabled={downloading}>
          {downloading ? 'Preparing…' : 'Download PDF'}
        </button>
        <button className="btn secondary" onClick={copyCode}>{copied ? 'Copied!' : 'Copy Code'}</button>
      </div>

      {canNotify && (
        <>
          <div className="field">
            <label htmlFor="recipient">Recipient (email address or phone in international format)</label>
            <input id="recipient" className="input" autoComplete="off" value={recipient}
              onChange={(e) => setRecipient(e.target.value)} placeholder="e.g. jane@example.com or +265991234567" />
          </div>
          <div className="actions">
            {channels.map((c) => (
              <button
                key={c.channel}
                className="btn secondary"
                disabled={!c.configured || sending || !recipient.trim()}
                title={c.configured ? `Send via ${c.label}` : `${c.label} provider not configured yet`}
                onClick={() => send(c.channel)}
              >
                {sending === c.channel ? 'Sending…' : c.label}
                {!c.configured && ' (setup required)'}
              </button>
            ))}
          </div>
          {feedback.text && <p className={feedback.kind === 'error' ? 'error' : 'muted'}>{feedback.text}</p>}
        </>
      )}

      <h3>Delivery Log</h3>
      {deliveries.length === 0 ? (
        <p className="muted">No delivery attempts recorded.</p>
      ) : (
        <table className="table">
          <thead><tr><th>Date</th><th>Channel</th><th>Recipient</th><th>Status</th><th>Note</th></tr></thead>
          <tbody>
            {deliveries.map((d) => (
              <tr key={d.id}>
                <td>{new Date(d.createdAt).toLocaleString('en-GB')}</td>
                <td>{d.channel}</td>
                <td>{d.recipient}</td>
                <td><span className={`badge delivery-${d.status}`}>{d.status}</span></td>
                <td className="muted small">{d.error || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
