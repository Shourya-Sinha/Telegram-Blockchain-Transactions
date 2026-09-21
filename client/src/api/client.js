import axios from 'axios';

const api = axios.create({ baseURL: '/api', timeout: 15000 });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('tbt_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && !location.pathname.includes('/login')) {
      localStorage.removeItem('tbt_token');
      // don't hard-redirect on public pages
    }
    return Promise.reject(err);
  }
);

export default api;
export const errMsg = (e, fb = 'Something went wrong') => e?.response?.data?.error || e.message || fb;
