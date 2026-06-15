import api from './client';

export const listReturns = (params) => api.get('/returns', { params }).then(r => r.data);
export const returnStats = ()       => api.get('/returns/stats').then(r => r.data);
