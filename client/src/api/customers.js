import api from './client';

export const listCustomers = (params) => api.get('/customers', { params }).then(r => r.data);
export const getCustomer   = (id)     => api.get(`/customers/${id}`).then(r => r.data);
export const createCustomer = (body)  => api.post('/customers', body).then(r => r.data);
export const updateCustomer = (id, body) => api.patch(`/customers/${id}`, body).then(r => r.data);
