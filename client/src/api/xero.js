import api from './client';

export const xeroStatus       = ()        => api.get('/xero/status').then(r => r.data);
export const xeroDisconnect   = ()        => api.delete('/xero/disconnect').then(r => r.data);
export const xeroConnectUrl   = ()        => '/api/xero/connect';
export const xeroContactSearch = (q)      => api.get('/xero/contacts/search', { params: { q } }).then(r => r.data);
export const xeroMatchStatus  = ()        => api.get('/xero/customers/match-status').then(r => r.data);
export const xeroLinkCustomer = (id, xero_contact_id, xero_contact_name) =>
  api.put(`/xero/customers/${id}/link`, { xero_contact_id, xero_contact_name }).then(r => r.data);
export const xeroUnlinkCustomer = (id)    => api.delete(`/xero/customers/${id}/link`).then(r => r.data);
export const xeroAutoMatch    = ()        => api.post('/xero/customers/auto-match').then(r => r.data);
export const xeroCustomerFinance = (id)   => api.get(`/xero/customers/${id}/finance`).then(r => r.data);
