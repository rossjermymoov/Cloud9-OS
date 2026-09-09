/**
 * Cloud9 OS — Collections API (UPS pickup bookings)
 *
 * GET  /api/collections              — list recent collections
 * POST /api/collections              — book a new collection with UPS
 * POST /api/collections/cancel       — cancel a collection by PRN
 * POST /api/collections/reschedule   — reschedule a collection with UPS
 */

import express from 'express';
import { query } from '../db/index.js';
import { createPickup, cancelPickup } from '../services/upsClient.js';

const router = express.Router();

// GET /api/collections — list recent collections (excluding failed attempts), enriched with live tracking status
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const { rows } = await query(
      `SELECT 
         c.*,
         p.status AS tracking_status,
         p.status_description AS tracking_description,
         p.last_location AS tracking_location,
         p.last_event_at AS tracking_event_at,
         p.delivered_at AS tracking_delivered_at
       FROM collections c
       LEFT JOIN parcels p ON p.consignment_number = c.tracking_number
       WHERE c.status != 'failed' AND c.prn IS NOT NULL
       ORDER BY c.created_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json({ collections: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/collections — create / book a pickup with UPS
router.post('/', async (req, res, next) => {
  try {
    const payload = req.body || {};
    const { addressLine1, addressLine, address, city, postalCode, postcode, phone } = payload;
    const addr = addressLine1 || addressLine || address;
    const pc = postalCode || postcode;

    if (!addr || !city || !pc) {
      return res.status(400).json({ ok: false, error: 'Address line, city, and postal code are required.' });
    }
    if (!phone) {
      return res.status(400).json({ ok: false, error: 'Phone number is required for collections.' });
    }

    const r = await createPickup(payload);

    if (!r.ok) {
      return res.status(400).json({
        ok: false,
        error: r.error,
        status: r.status,
        raw: r.raw,
        request: r.request,
      });
    }

    let saved = null;
    try {
      const fullAddress = addr + (payload.addressLine2 ? ', ' + payload.addressLine2 : '');
      const { rows } = await query(
        `INSERT INTO collections (
          prn, status, company_name, contact_name, phone, email,
          address_line, city, postal_code, country_code,
          pickup_date, ready_time, close_time, parcels, total_weight_kg,
          tracking_number, special_instruction, service_code, response, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
        RETURNING id, prn, created_at, status`,
        [
          r.prn,
          'booked',
          payload.companyName || payload.company || payload.contactName || 'Cloud9 Fulfillment',
          payload.contactName || payload.companyName || 'Joshua Hegarty',
          payload.phone || '0114 551 138',
          payload.email || 'service@cloud9fulfillment.co.uk',
          fullAddress || null,
          payload.city || 'Sheffield',
          pc || 'S9 3AJ',
          payload.country || 'GB',
          payload.pickupDate || null,
          payload.readyTime || null,
          payload.closeTime || null,
          Math.max(1, Math.floor(Number(payload.parcels) || 1)),
          Number(payload.weight || payload.totalWeight) || 1.0,
          payload.trackingNumber || null,
          payload.specialInstruction || payload.instructions || null,
          payload.serviceCode || '011',
          r.json ? JSON.stringify(r.json) : (r.raw ? JSON.stringify({ raw: r.raw }) : null),
          req.user?.id || null,
        ]
      );
      saved = rows[0];
    } catch (dbErr) {
      console.error('[collections db]', dbErr.message);
    }

    res.json({
      ok: true,
      prn: r.prn,
      rateStatus: r.rateStatus,
      savedId: saved ? saved.id : null,
      createdAt: saved ? saved.created_at : new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/collections/cancel — cancel a collection by PRN
router.post('/cancel', async (req, res, next) => {
  try {
    const { prn } = req.body || {};
    if (!prn) return res.status(400).json({ ok: false, error: 'PRN is required to cancel a pickup.' });

    const cancelRes = await cancelPickup(prn);

    try {
      await query(
        `UPDATE collections
         SET status = 'cancelled',
             response = COALESCE(response, '{}'::jsonb) || $2::jsonb,
             updated_at = NOW()
         WHERE prn = $1`,
        [String(prn).trim(), JSON.stringify({ cancel: cancelRes })]
      );
    } catch (dbErr) {
      console.error('[collections cancel db]', dbErr.message);
    }

    if (!cancelRes.ok) {
      return res.status(400).json({
        ok: false,
        error: cancelRes.error,
        status: cancelRes.status,
        raw: cancelRes.raw,
      });
    }

    res.json({
      ok: true,
      prn,
      message: 'Collection PRN ' + prn + ' successfully cancelled with UPS.',
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/collections/reschedule — cancel old collection and book new window
router.post('/reschedule', async (req, res, next) => {
  try {
    const { oldPrn, pickupDate, readyTime, closeTime, instructions } = req.body || {};
    if (!oldPrn) return res.status(400).json({ ok: false, error: 'Existing PRN (oldPrn) is required.' });
    if (!pickupDate) return res.status(400).json({ ok: false, error: 'New pickup date is required.' });

    const { rows } = await query(`SELECT * FROM collections WHERE prn = $1`, [String(oldPrn).trim()]);
    const oldCol = rows[0];

    // Cancel old pickup with UPS
    const cancelRes = await cancelPickup(oldPrn);

    // Build payload for new pickup
    const newPayload = {
      pickupDate,
      readyTime: readyTime || oldCol?.ready_time || '10:00',
      closeTime: closeTime || oldCol?.close_time || '17:00',
      companyName: oldCol?.company_name || 'Sender',
      contactName: oldCol?.contact_name || 'Contact',
      phone: oldCol?.phone || '07498991612',
      email: oldCol?.email || '',
      address: oldCol?.address_line || 'Address',
      city: oldCol?.city || 'City',
      postalCode: oldCol?.postal_code || '',
      country: oldCol?.country_code || 'GB',
      parcels: oldCol?.parcels || 1,
      totalWeight: oldCol?.total_weight_kg || 1.0,
      specialInstruction: instructions || oldCol?.special_instruction || '',
      serviceCode: oldCol?.service_code || '011',
      trackingNumber: oldCol?.tracking_number || null,
    };

    const newPickup = await createPickup(newPayload);

    if (!newPickup.ok) {
      return res.status(400).json({
        ok: false,
        error: 'Failed to book rescheduled pickup with UPS: ' + newPickup.error,
        cancel: cancelRes,
        newPickup,
      });
    }

    // Update old collection status and insert new record
    try {
      await query(
        `UPDATE collections
         SET status = 'rescheduled',
             response = COALESCE(response, '{}'::jsonb) || $2::jsonb,
             updated_at = NOW()
         WHERE prn = $1`,
        [String(oldPrn).trim(), JSON.stringify({ rescheduleTo: newPickup.prn, cancel: cancelRes })]
      );

      await query(
        `INSERT INTO collections (
          prn, status, company_name, contact_name, phone, email,
          address_line, city, postal_code, country_code,
          pickup_date, ready_time, close_time, parcels, total_weight_kg,
          tracking_number, special_instruction, service_code, response, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [
          newPickup.prn,
          'booked',
          newPayload.companyName,
          newPayload.contactName,
          newPayload.phone,
          newPayload.email,
          newPayload.address,
          newPayload.city,
          newPayload.postalCode,
          newPayload.country,
          pickupDate,
          newPayload.readyTime,
          newPayload.closeTime,
          newPayload.parcels,
          newPayload.totalWeight,
          newPayload.trackingNumber,
          newPayload.specialInstruction,
          newPayload.serviceCode,
          newPickup.json ? JSON.stringify(newPickup.json) : null,
          req.user?.id || null,
        ]
      );
    } catch (dbErr) {
      console.error('[collections reschedule db]', dbErr.message);
    }

    res.json({
      ok: true,
      oldPrn,
      newPrn: newPickup.prn,
      pickupDate,
      readyTime: newPayload.readyTime,
      closeTime: newPayload.closeTime,
      rateStatus: newPickup.rateStatus,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/collections/sync-tracking — trigger on-demand sync of UPS tracking events
router.post('/sync-tracking', async (req, res, next) => {
  try {
    const { syncCollectionsTracking } = await import('../services/upsClient.js');
    const updatedCount = await syncCollectionsTracking();
    res.json({ ok: true, synced: updatedCount });
  } catch (err) {
    next(err);
  }
});

export default router;
