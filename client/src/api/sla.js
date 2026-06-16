import api from './client';

export const slaSummary   = (period = 'week', { customer_id, date } = {}) =>
  api.get('/sla/summary', { params: { period, customer_id, date } }).then(r => r.data);
export const slaBreaches  = (period = 'week', { view = 'breaches', customer_id, date } = {}) =>
  api.get('/sla/breaches', { params: { period, view, customer_id, date } }).then(r => r.data);
export const slaCutoffs   = () => api.get('/sla/cutoffs').then(r => r.data);
export const setCutoff    = (id, cutoff_time) => api.patch(`/sla/cutoffs/${id}`, { cutoff_time }).then(r => r.data);
export const slaFreshness = () => api.get('/sla/freshness').then(r => r.data);
export const triggerSlaSync = (days = 14) => api.post('/sla/sync', null, { params: { days } }).then(r => r.data);
