import axios from 'axios';
import { getAuthToken } from '../context/AuthContext';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On an expired/invalid session, drop the token and bounce to the login screen.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401) {
      localStorage.removeItem('cloud9_auth_token');
      if (!String(window.location.pathname).startsWith('/login')) window.location.reload();
    }
    return Promise.reject(err);
  }
);

export default api;
