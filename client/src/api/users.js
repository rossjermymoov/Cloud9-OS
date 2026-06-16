import api from './client';

export const listUsers   = ()              => api.get('/auth/users').then(r => r.data);
export const createUser  = (payload)       => api.post('/auth/users', payload).then(r => r.data);
export const updateUser  = (id, payload)   => api.patch(`/auth/users/${id}`, payload).then(r => r.data);
export const deactivateUser = (id)         => api.delete(`/auth/users/${id}`).then(r => r.data);
