import api from './client';

export const storageSummary    = ()   => api.get('/storage/summary').then(r => r.data);
export const storageByCustomer = ()   => api.get('/storage/by-customer').then(r => r.data);
export const storageByLocation = ()   => api.get('/storage/by-location').then(r => r.data);
export const storageCustomer   = (id) => api.get(`/storage/customer/${id}`).then(r => r.data);
export const storageFreshness  = ()   => api.get('/storage/freshness').then(r => r.data);
export const triggerStorageSync = ()  => api.post('/storage/sync').then(r => r.data);
export const storageCustomerDebug = (q) => api.get('/storage/customer-debug', { params: { q } }).then(r => r.data);
