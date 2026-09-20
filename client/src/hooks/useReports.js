import { useCallback, useEffect, useState } from 'react';
import api from '../services/api.js';

function toParams(obj) {
  const params = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== '' && v !== null && v !== undefined) params[k] = v;
  }
  return params;
}

function useFetch(path, depsKey) {
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

export function buildQuery(params) {
  const q = new URLSearchParams(toParams(params)).toString();
  return q ? `?${q}` : '';
}

export function useSummary({ from, to }) {
  return useFetch(`/reports/summary${buildQuery({ from, to })}`, `${from}|${to}`);
}

export function useRedemptions({ from, to, store, page, limit }) {
  return useFetch(
    `/reports/redemptions${buildQuery({ from, to, store, page, limit })}`,
    `${from}|${to}|${store}|${page}|${limit}`
  );
}

export function useAnalytics(endpoint, params) {
  return useFetch(`/reports/${endpoint}${buildQuery(params)}`, `${endpoint}|${JSON.stringify(params)}`);
}

export async function downloadCsv(endpoint, params, filename) {
  const { data } = await api.get(`/reports/${endpoint}${buildQuery({ ...params, format: 'csv' })}`, {
    responseType: 'blob',
  });
  const url = window.URL.createObjectURL(new Blob([data], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
