import api from './client';

export const listCustomers  = (params) => api.get('/customers', { params }).then(r => r.data);
export const getCustomer    = (id)     => api.get(`/customers/${id}`).then(r => r.data);
export const createCustomer = (body)   => api.post('/customers', body).then(r => r.data);
export const updateCustomer = (id, body) => api.patch(`/customers/${id}`, body).then(r => r.data);

// Contacts
export const addContact    = (id, data)      => api.post(`/customers/${id}/contacts`, data).then(r => r.data);
export const updateContact = (id, cid, data) => api.patch(`/customers/${id}/contacts/${cid}`, data).then(r => r.data);
export const deleteContact = (id, cid)       => api.delete(`/customers/${id}/contacts/${cid}`).then(r => r.data);

// Communications
export const listCommunications = (id)       => api.get(`/customers/${id}/communications`).then(r => r.data);
export const addCommunication   = (id, data) => api.post(`/customers/${id}/communications`, data).then(r => r.data);
