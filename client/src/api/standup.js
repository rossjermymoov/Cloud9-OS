import api from './client';

export const getStandupSummary = () =>
  api.get('/standup/summary').then(res => res.data);

export const refreshStandupSummary = () =>
  api.post('/standup/refresh').then(res => res.data);
