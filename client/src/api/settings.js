import api from './client';

// Branding & White-Labeling
export const getBranding        = ()              => api.get('/settings/branding').then(r => r.data);
export const saveBranding       = (branding)      => api.put('/settings/branding', branding).then(r => r.data);

// Helm WMS Integration
export const getHelmIntegration = ()              => api.get('/settings/helm-integration').then(r => r.data);
export const saveHelmIntegration = (creds)        => api.put('/settings/helm-integration', creds).then(r => r.data);
export const testHelmConnection = (creds)        => api.post('/settings/helm-test', creds).then(r => r.data);

// Warehouse-board messages (welcome slide + urgent banner)
export const getBoardMessages   = ()              => api.get('/settings/board-messages').then(r => r.data);
export const saveBoardWelcome   = (enabled, who)  => api.put('/settings/board-welcome', { enabled, who }).then(r => r.data);
export const saveBoardUrgent    = (message, minutes) => api.put('/settings/board-urgent', { message, minutes }).then(r => r.data);
export const clearBoardUrgent   = ()              => api.put('/settings/board-urgent', { clear: true }).then(r => r.data);

// Gmail integration
export const gmailStatus     = () => api.get('/gmail/status').then(r => r.data);
export const gmailSyncNow    = () => api.post('/gmail/sync').then(r => r.data);
export const gmailDisconnect = () => api.delete('/gmail/disconnect').then(r => r.data);
// OAuth start is a full-page redirect to Google; the JWT travels as a query token
// because a browser navigation can't send the Authorization header. The /auth route
// is public (per-route guards protect the data endpoints).
export const gmailConnectUrl = () => '/api/gmail/auth';
