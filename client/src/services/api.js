import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('sw_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    // Only a dead *session* logs the device out: HTTP 401 + SESSION_INVALID
    // (bad/expired token, deactivated account). Business-logic failures such
    // as a wrong customer till PIN never use 401, so the cashier stays signed
    // in and the error is shown inline at the till instead.
    if (err.response?.status === 401 && err.response?.data?.code === 'SESSION_INVALID') {
      localStorage.removeItem('sw_token');
      localStorage.removeItem('sw_user');
      if (!window.location.pathname.includes('/login')) window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
