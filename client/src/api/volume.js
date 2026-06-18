import api from './client';

export const volumeSummary     = ()        => api.get('/volume/summary').then(r => r.data);
export const volumeDaily       = (days = 14) => api.get('/volume/daily', { params: { days } }).then(r => r.data);
export const volumeByCustomer  = (days = 1)  => api.get('/volume/by-customer', { params: { days } }).then(r => r.data);
export const volumeWeekly      = ()        => api.get('/volume/weekly').then(r => r.data);
const exclParam = (exclude) => (Array.isArray(exclude) && exclude.length ? exclude.join(',') : undefined);
export const volumeTrend       = (period = 'week', date = null, exclude = null) =>
  api.get('/volume/trend', { params: { period, date, exclude: exclParam(exclude) } }).then(r => r.data);
export const volumeLeaderboard = ({ period = 'month', metric = 'parcels', sort = 'growth', limit = 6, date = null, exclude = null } = {}) =>
  api.get('/volume/leaderboard', { params: { period, metric, sort, limit, date, exclude: exclParam(exclude) } }).then(r => r.data);
export const volumeCustomer    = (id, { from, to } = {}) =>
  api.get(`/volume/customer/${id}`, { params: { from, to } }).then(r => r.data);
