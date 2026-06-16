import api from './client';

export const listPurchaseOrders = (params) => api.get('/purchase-orders', { params }).then(r => r.data);
export const poStats            = ()       => api.get('/purchase-orders/stats').then(r => r.data);
export const getPurchaseOrder   = (id)     => api.get(`/purchase-orders/${id}`).then(r => r.data);
export const triggerPoSync      = ()       => api.post('/helm/sync/purchase-orders').then(r => r.data);
