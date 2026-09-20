import { useCallback, useEffect, useState } from 'react';
import api from '../services/api.js';

// ADMIN-only system settings (closed key set, audited changes).
export default function Settings() {
  const [settings, setSettings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(null);
  const [msg, setMsg] = useState({ kind: '', text: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/settings');
      setSettings(data.settings ?? []);
      setDrafts(Object.fromEntries((data.settings ?? []).map((s) => [s.key, s.value])));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (key) => {
    setSaving(key);
    setMsg({ kind: '', text: '' });
    try {
      await api.patch(`/settings/${encodeURIComponent(key)}`, { value: drafts[key] });
      setMsg({ kind: 'ok', text: `${key} updated.` });
      load();
    } catch (err) {
      setMsg({ kind: 'error', text: err.response?.data?.error || 'Update failed.' });
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="container wide">
      <div className="page-head"><h1>Settings</h1></div>
      {msg.text && <p className={msg.kind === 'error' ? 'error' : 'muted'}>{msg.text}</p>}
      {loading && <div className="card"><p className="muted">Loading settings…</p></div>}
      {!loading && error && (
        <div className="card error-state">
          <p className="error">{error}</p>
          <button className="btn" onClick={load}>Retry</button>
        </div>
      )}
      {!loading && !error && (
        <div className="card">
          <table className="table">
            <thead><tr><th>Setting</th><th>Value</th><th></th></tr></thead>
            <tbody>
              {settings.map((s) => (
                <tr key={s.key}>
                  <td><strong>{s.key}</strong><div className="muted small">{s.description}</div></td>
                  <td>
                    <input className="input" type={typeof s.value === 'number' ? 'number' : 'text'}
                      value={drafts[s.key] ?? ''} onChange={(e) => setDrafts({ ...drafts, [s.key]: typeof s.value === 'number' ? Number(e.target.value) : e.target.value })} />
                  </td>
                  <td><button className="btn secondary" disabled={saving === s.key} onClick={() => save(s.key)}>Save</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
