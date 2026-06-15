import axios from 'axios';
import { getAuthToken } from '../context/AuthContext';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;
