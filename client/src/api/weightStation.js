import api from './client';

export const searchProducts = (q) =>
  api.get('/weight-station/search', { params: { q } }).then(r => r.data);

export const updateProductWeight = (payload) =>
  api.post('/weight-station/update', payload).then(r => r.data);

export const getWeightLogs = ({ q = '', limit = 50, offset = 0 } = {}) =>
  api.get('/weight-station/logs', { params: { q: q || undefined, limit, offset } }).then(r => r.data);
