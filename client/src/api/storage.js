import api from './client';

const excl = (e) => (Array.isArray(e) && e.length ? e.join(',') : undefined);
export const storageSummary    = (exclude = null) => api.get('/storage/summary',     { params: { exclude: excl(exclude) } }).then(r => r.data);
export const storageByCustomer = (exclude = null) => api.get('/storage/by-customer', { params: { exclude: excl(exclude) } }).then(r => r.data);
export const storageByLocation = (exclude = null) => api.get('/storage/by-location', { params: { exclude: excl(exclude) } }).then(r => r.data);
export const storageCustomer   = (id) => api.get(`/storage/customer/${id}`).then(r => r.data);
export const storageFreshness  = ()   => api.get('/storage/freshness').then(r => r.data);
export const triggerStorageSync = ()  => api.post('/storage/sync').then(r => r.data);
export const storageCustomerDebug = (q) => api.get('/storage/customer-debug', { params: { q } }).then(r => r.data);
export const storageMissingDimensions = () => api.get('/storage/missing-dimensions').then(r => r.data);
