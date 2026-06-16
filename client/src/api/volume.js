import api from './client';

export const volumeSummary     = ()        => api.get('/volume/summary').then(r => r.data);
export const volumeDaily       = (days = 14) => api.get('/volume/daily', { params: { days } }).then(r => r.data);
export const volumeByCustomer  = (days = 1)  => api.get('/volume/by-customer', { params: { days } }).then(r => r.data);
export const volumeWeekly      = ()        => api.get('/volume/weekly').then(r => r.data);
export const volumeTrend       = (period = 'week') => api.get('/volume/trend', { params: { period } }).then(r => r.data);
export const volumeLeaderboard = (limit = 5) => api.get('/volume/leaderboard', { params: { limit } }).then(r => r.data);
