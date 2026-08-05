import api from './client';

export const inventoryFields   = (customerId) =>
  api.get('/inventory/fields', { params: { customer_id: customerId || undefined } }).then(r => r.data);
export const startInventoryValidation = ({ scope = 'customer', customerId = null, fields = [] }) =>
  api.post('/inventory/validate', { scope, customer_id: customerId, fields }).then(r => r.data);
export const getInventoryValidation   = (runId) =>
  api.get(`/inventory/validate/${runId}`).then(r => r.data);
