import api from './client';

export const searchProducts = (barcode) =>
  api.get('/weight-station/search', { params: { barcode } }).then(r => r.data);

export const updateProductWeight = (payload) =>
  api.post('/weight-station/update', payload).then(r => r.data);

export const getWeightLogs = ({ q = '', limit = 50, offset = 0 } = {}) =>
  api.get('/weight-station/logs', { params: { q: q || undefined, limit, offset } }).then(r => r.data);

export const triggerInventorySync = () =>
  api.post('/weight-station/sync').then(r => r.data);

export const getInventorySyncStatus = () =>
  api.get('/weight-station/sync-status').then(r => r.data);

export const getDebugSample = () =>
  api.get('/weight-station/debug-sample').then(r => r.data);
