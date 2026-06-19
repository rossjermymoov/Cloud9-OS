import api from './client';

export const pickingSummary     = (period = 'week', date = null) => api.get('/picking/summary', { params: { period, date } }).then(r => r.data);
export const pickingDaily       = (period = 'week', date = null) => api.get('/picking/daily', { params: { period, date } }).then(r => r.data);
export const pickingLeaderboard = (period = 'week', date = null) => api.get('/picking/leaderboard', { params: { period, date } }).then(r => r.data);
export const pickingPicks       = (period = 'week', date = null) => api.get('/picking/picks', { params: { period, date } }).then(r => r.data);
export const pickingDebug       = (period = 'week', date = null) => api.get('/picking/debug', { params: { period, date } }).then(r => r.data);
export const pickingFreshness   = ()                => api.get('/picking/freshness').then(r => r.data);
export const triggerPickSync    = (days = 30)       => api.post('/picking/sync', null, { params: { days } }).then(r => r.data);
export const pickingSettings    = ()                => api.get('/picking/settings').then(r => r.data);
export const savePickingDayWindow = (start_hour, end_hour) =>
  api.put('/picking/settings/day-window', { start_hour, end_hour }).then(r => r.data);
