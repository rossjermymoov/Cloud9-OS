import api from './client';

export async function listCollections({ limit = 50 } = {}) {
  const res = await api.get('/collections', { params: { limit } });
  return res.data;
}

export async function createCollection(payload) {
  const res = await api.post('/collections', payload);
  return res.data;
}

export async function cancelCollection(prn) {
  const res = await api.post('/collections/cancel', { prn });
  return res.data;
}

export async function rescheduleCollection({ oldPrn, pickupDate, readyTime, closeTime, instructions }) {
  const res = await api.post('/collections/reschedule', {
    oldPrn,
    pickupDate,
    readyTime,
    closeTime,
    instructions,
  });
  return res.data;
}
