import api from './client';

export const pickingSummary     = (period = 'week') => api.get('/picking/summary', { params: { period } }).then(r => r.data);
export const pickingDaily       = (period = 'week') => api.get('/picking/daily', { params: { period } }).then(r => r.data);
export const pickingLeaderboard = (period = 'week') => api.get('/picking/leaderboard', { params: { period } }).then(r => r.data);
export const pickingFreshness   = ()                => api.get('/picking/freshness').then(r => r.data);
export const triggerPickSync    = (days = 30)       => api.post('/picking/sync', null, { params: { days } }).then(r => r.data);
