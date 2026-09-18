import api from './client';

// The field schema is the same across customers and rarely changes, so the
// server caches it. Pass refresh=true to force a live re-discovery from Helm.
export const inventoryFields   = (refresh = false) =>
  api.get('/inventory/fields', { params: { refresh: refresh ? 1 : undefined } }).then(r => r.data);
export const startInventoryValidation = ({ scope = 'customer', customerId = null, fields = [] }) =>
  api.post('/inventory/validate', { scope, customer_id: customerId, fields }).then(r => r.data);
export const getInventoryValidation   = (runId) =>
  api.get(`/inventory/validate/${runId}`).then(r => r.data);
export const dismissAlert = ({ customerId, sku, alertType, reason }) =>
  api.post('/inventory/dismiss-alert', { customer_id: customerId, sku, alert_type: alertType, reason }).then(r => r.data);
export const undismissAlert = ({ customerId, sku, alertType }) =>
  api.post('/inventory/undismiss-alert', { customer_id: customerId, sku, alert_type: alertType }).then(r => r.data);
export const getDismissedAlerts = (customerId = null) =>
  api.get('/inventory/dismissed-alerts', { params: { customer_id: customerId || undefined } }).then(r => r.data);
