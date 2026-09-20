import { useCallback, useEffect, useState } from 'react';
import api from '../services/api.js';

export function buildQuery(params) {
  const clean = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== '' && v !== null && v !== undefined) clean[k] = v;
  }
  const q = new URLSearchParams(clean).toString();
  return q ? `?${q}` : '';
}

function useGet(path, depsKey) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(path);
      setData(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load data');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsKey]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, retry: load };
}

export function useVouchers(filters) {
  const key = JSON.stringify(filters);
  return useGet(`/vouchers${buildQuery(filters)}`, key);
}

export function useVoucher(id) {
  return useGet(`/vouchers/${id}`, id);
}

export function useLookup() {
  const [lookups, setLookups] = useState({ stores: [], customers: [], campaigns: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, c, cm] = await Promise.all([
          api.get('/stores?active=true'),
          api.get('/customers'),
          api.get('/campaigns?active=true'),
        ]);
        if (!cancelled) {
          setLookups({ stores: s.data.stores ?? [], customers: c.data.customers ?? [], campaigns: cm.data.campaigns ?? [] });
        }
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.error || 'Failed to load form data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { ...lookups, loading, error };
}
