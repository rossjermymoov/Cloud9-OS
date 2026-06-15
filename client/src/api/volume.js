import api from './client';

export const volumeSummary    = ()        => api.get('/volume/summary').then(r => r.data);
export const volumeDaily      = (days = 14) => api.get('/volume/daily', { params: { days } }).then(r => r.data);
export const volumeByCustomer = (days = 1)  => api.get('/volume/by-customer', { params: { days } }).then(r => r.data);
