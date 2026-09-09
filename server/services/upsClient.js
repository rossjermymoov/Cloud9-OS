/**
 * Cloud9 OS — UPS Collection & Pickup Client
 * Direct integration with UPS OAuth & Pickup Creation / Cancellation APIs.
 */

import { nameToIso } from './countries.js';

const PROD = 'https://onlinetools.ups.com';
const TEST = 'https://wwwcie.ups.com';

const base = () => (String(process.env.UPS_ENV || 'test').toLowerCase().startsWith('prod') ? PROD : TEST);

const S = (v) => (v == null ? '' : String(v));

export const configured = () => !!(process.env.UPS_CLIENT_ID && process.env.UPS_CLIENT_SECRET);

let _tok = null;

export async function token() {
  if (!configured()) return null;
  if (_tok && _tok.exp > Date.now() + 60000) return _tok.access_token;
  const cred = Buffer.from(process.env.UPS_CLIENT_ID + ':' + process.env.UPS_CLIENT_SECRET).toString('base64');
  const res = await fetch(base() + '/security/v1/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + cred,
      'x-merchant-id': process.env.UPS_ACCOUNT_NUMBER || '',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error('UPS OAuth ' + res.status + ': ' + text.slice(0, 300));
  const d = JSON.parse(text);
  _tok = { access_token: d.access_token, exp: Date.now() + (Number(d.expires_in || 3600) * 1000) };
  return _tok.access_token;
}

export function buildPickupRequest(p) {
  const acct = process.env.UPS_ACCOUNT_NUMBER || '';
  const today = new Date();
  const defaultDateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  const dateStr = String(p.pickupDate || defaultDateStr).replace(/[^0-9]/g, '');
  const readyStr = String(p.readyTime || '10:00').replace(/[^0-9]/g, '').padEnd(4, '0').slice(0, 4);
  const closeStr = String(p.closeTime || '17:00').replace(/[^0-9]/g, '').padEnd(4, '0').slice(0, 4);

  // Format address line
  // In the UPS REST PickupCreation API, PickupAddress.AddressLine must be a single string (max 35 chars).
  // Multi-line arrays trigger "missing or invalid address line" schema validation errors.
  let fullAddr = [p.addressLine1 || p.addressLine || p.address, p.addressLine2]
    .map(S)
    .join(' ')
    .replace(/[,;.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!fullAddr) {
    fullAddr = 'Units 3-5 Kettlebridge Road';
  }
  const addressLineValue = fullAddr.slice(0, 35);

  let phone = String(p.phone || '').replace(/[^0-9+]/g, '');
  if (!phone || phone.length < 7) phone = '0114551138';
  const email = S(p.email || 'service@cloud9fulfillment.co.uk').trim();
  const parcels = Math.max(1, Math.floor(Number(p.parcels) || 1));
  const weight = Math.max(0.1, Number(p.weight || p.totalWeight) || 1.0);

  const toIso = (c, fallback = 'GB') => {
    if (!c) return fallback;
    const iso = nameToIso(c);
    if (iso) return iso;
    const s = String(c).trim();
    if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
    return fallback;
  };

  const originCountry = toIso(p.country || 'GB', 'GB');
  const destCountry = toIso(p.destinationCountry || p.destCountry || p.country || 'GB', 'GB');
  let rawSvc = String(p.serviceCode || '011').trim();
  if (rawSvc === '65') rawSvc = '065';
  if (rawSvc === '11') rawSvc = '011';
  if (rawSvc === '7' || rawSvc === '07') rawSvc = '007';
  const serviceCode = rawSvc.padStart(3, '0');
  const trackingNumber = p.trackingNumber ? String(p.trackingNumber).trim() : null;

  const req = {
    PickupCreationRequest: {
      RatePickupIndicator: 'N',
      Shipper: {
        Account: {
          AccountNumber: acct,
          AccountCountryCode: 'GB',
        },
      },
      PickupDateInfo: {
        CloseTime: closeStr,
        ReadyTime: readyStr,
        PickupDate: dateStr,
      },
      PickupAddress: {
        CompanyName: S(p.companyName || 'Cloud9 Fulfillment').trim().slice(0, 35),
        ContactName: S(p.contactName || 'Joshua Hegarty').trim().slice(0, 35),
        AddressLine: addressLineValue,
        City: S(p.city || 'Sheffield').trim().slice(0, 30),
        PostalCode: S(p.postalCode || p.postcode || 'S9 3AJ').trim().replace(/\s+/g, ' ').slice(0, 10),
        CountryCode: originCountry || 'GB',
        ResidentialIndicator: p.residential ? 'Y' : 'N',
        Phone: {
          Number: phone.slice(0, 15),
        },
      },
      AlternateAddressIndicator: 'Y',
      PickupPiece: [
        {
          ServiceCode: serviceCode,
          Quantity: String(parcels),
          DestinationCountryCode: destCountry || 'GB',
          ContainerCode: S(p.containerCode || '01'),
        },
      ],
      TotalWeight: {
        Weight: weight.toFixed(1),
        UnitOfMeasurement: 'KGS',
      },
      OverweightIndicator: 'N',
      PaymentMethod: '01',
    },
  };

  if (email) {
    req.PickupCreationRequest.PickupAddress.EMailAddress = email;
  }
  let instructions = S(p.specialInstruction || p.instructions || '').slice(0, 100);
  const isCrossBorder = originCountry && destCountry && originCountry.toUpperCase() !== destCountry.toUpperCase();
  if (isCrossBorder && !instructions.toLowerCase().includes('invoice')) {
    const invNote = p.hasElectronicDocs ? 'Electronic Invoice uploaded.' : 'Commercial Invoices (x3) with packages.';
    instructions = instructions ? (invNote + ' ' + instructions).slice(0, 100) : invNote;
  }
  if (instructions) {
    req.PickupCreationRequest.SpecialInstruction = instructions;
  }
  if (trackingNumber) {
    req.PickupCreationRequest.TrackingData = [{ TrackingNumber: trackingNumber }];
  }

  return req;
}

export async function createPickup(payload) {
  const tk = await token();
  if (!tk) return { ok: false, error: 'UPS credentials not configured (UPS_CLIENT_ID / UPS_CLIENT_SECRET)' };

  const reqBody = buildPickupRequest(payload);
  const headers = {
    'Authorization': 'Bearer ' + tk,
    'Content-Type': 'application/json',
    'transId': 'cloud9_pickup_' + Date.now(),
    'transactionSrc': 'Cloud9-OS',
  };
  if (process.env.UPS_ACCOUNT_NUMBER) {
    headers['x-merchant-id'] = process.env.UPS_ACCOUNT_NUMBER;
  }
  const res = await fetch(base() + '/api/pickupcreation/v1/pickup', {
    method: 'POST',
    headers,
    body: JSON.stringify(reqBody),
    signal: AbortSignal.timeout(12000),
  });

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}

  if (!res.ok) {
    let errMsg = 'UPS Pickup ' + res.status;
    if (json && json.response && json.response.errors && json.response.errors.length) {
      errMsg = json.response.errors.map((e) => e.message || e.code).join('; ');
    } else if (json && json.Error && json.Error.Description) {
      errMsg = json.Error.Description;
    } else if (json && json.PickupCreationResponse && json.PickupCreationResponse.Response && json.PickupCreationResponse.Response.Error) {
      const err = json.PickupCreationResponse.Response.Error;
      errMsg = err.ErrorDescription || err.Description || JSON.stringify(err);
    } else if (text) {
      errMsg += ': ' + text.slice(0, 300);
    }
    console.error('[ups pickup failed]', errMsg, 'Request:', JSON.stringify(reqBody), 'Response:', text);
    return { ok: false, status: res.status, error: errMsg, raw: text, request: reqBody };
  }

  const pResp = (json && json.PickupCreationResponse) || {};
  const prn = pResp.PRN || (pResp.Response && pResp.Response.PRN) || null;
  const rateStatus = pResp.RateStatus || (pResp.PickupRate && pResp.PickupRate.RateStatus) || 'OK';
  return {
    ok: true,
    prn,
    rateStatus,
    status: res.status,
    raw: text,
    json,
    request: reqBody,
  };
}

export async function cancelPickup(prn) {
  if (!prn) return { ok: false, error: 'PRN is required for cancellation' };
  const tk = await token();
  if (!tk) return { ok: false, error: 'UPS credentials not configured' };

  const cleanPrn = String(prn).trim();
  const headers = {
    'Authorization': 'Bearer ' + tk,
    'transId': 'cloud9_cancel_' + Date.now(),
    'transactionSrc': 'Cloud9-OS',
    'Prn': cleanPrn,
  };

  const res = await fetch(base() + '/api/pickupcreation/v1/pickup/' + encodeURIComponent(cleanPrn), {
    method: 'DELETE',
    headers,
    signal: AbortSignal.timeout(12000),
  });

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}

  if (!res.ok) {
    let errMsg = 'UPS Pickup Cancellation ' + res.status;
    if (json && json.response && json.response.errors && json.response.errors.length) {
      errMsg = json.response.errors.map((e) => e.message || e.code).join('; ');
    } else if (json && json.Error && json.Error.Description) {
      errMsg = json.Error.Description;
    } else if (text) {
      errMsg += ': ' + text.slice(0, 300);
    }
    return { ok: false, status: res.status, error: errMsg, raw: text };
  }

  return {
    ok: true,
    status: res.status,
    raw: text,
    json,
  };
}

/**
 * Query UPS Track API v1 for a tracking number.
 * Returns normalized status, delivery info, and activity timeline.
 */
export async function trackShipment(trackingNumber) {
  if (!trackingNumber) return { ok: false, error: 'Tracking number is required' };
  const cleanTrack = String(trackingNumber).trim();
  const tk = await token();
  if (!tk) return { ok: false, error: 'UPS credentials not configured' };

  const headers = {
    'Authorization': 'Bearer ' + tk,
    'transId': 'cloud9_track_' + Date.now(),
    'transactionSrc': 'Cloud9-OS',
  };
  if (process.env.UPS_ACCOUNT_NUMBER) {
    headers['x-merchant-id'] = process.env.UPS_ACCOUNT_NUMBER;
  }

  const url = base() + `/api/track/v1/details/${encodeURIComponent(cleanTrack)}?locale=en_GB&returnSignature=false`;
  const res = await fetch(url, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(10000),
  });

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}

  if (!res.ok) {
    let errMsg = 'UPS Tracking ' + res.status;
    if (json?.response?.errors?.length) {
      errMsg = json.response.errors.map(e => e.message || e.code).join('; ');
    } else if (text) {
      errMsg += ': ' + text.slice(0, 200);
    }
    return { ok: false, status: res.status, error: errMsg, raw: text };
  }

  const shipment = json?.trackResponse?.shipment?.[0];
  const pkg = shipment?.package?.[0];
  const currentStatus = pkg?.currentStatus || shipment?.currentStatus;
  const rawStatus = currentStatus?.description || currentStatus?.code || 'in_transit';
  const activity = pkg?.activity || [];
  const latestActivity = activity[0] || {};
  const locationObj = latestActivity.location?.address;
  const location = locationObj ? [locationObj.city, locationObj.countryCode || locationObj.country].filter(Boolean).join(', ') : null;

  const deliveryDate = pkg?.deliveryDate?.[0]?.date || shipment?.deliveryDate?.[0]?.date;
  const deliveryTime = pkg?.deliveryTime?.endTime || shipment?.deliveryTime?.endTime;

  return {
    ok: true,
    trackingNumber: cleanTrack,
    rawStatus,
    statusCode: currentStatus?.code,
    statusDescription: currentStatus?.description || rawStatus,
    location,
    deliveryDate,
    deliveryTime,
    activity,
    json,
  };
}

/**
 * Cron Job: Sync tracking status for all recent UPS collections.
 * Finds collections created in the last 14 days with tracking numbers that aren't marked delivered/cancelled.
 */
export async function syncCollectionsTracking() {
  if (!configured()) return 0;
  const { query } = await import('../db/index.js');
  const { upsertEvent, normaliseStatus } = await import('./statusEngine.js');

  const { rows: collections } = await query(`
    SELECT c.id, c.prn, c.tracking_number, c.company_name, c.contact_name, c.phone, c.status,
           c.address_line, c.city, c.postal_code, c.total_weight_kg, c.pickup_date
    FROM collections c
    WHERE c.tracking_number IS NOT NULL
      AND c.tracking_number != ''
      AND c.status NOT IN ('delivered', 'cancelled', 'failed')
      AND c.created_at >= NOW() - INTERVAL '14 days'
    ORDER BY c.created_at DESC
  `);

  if (!collections.length) return 0;

  let updated = 0;
  for (const c of collections) {
    try {
      const res = await trackShipment(c.tracking_number);
      if (res.ok) {
        const normStatus = normaliseStatus(res.rawStatus);
        
        // Ingest event into the status engine (updates parcels and tracking_events tables)
        await upsertEvent({
          consignment_number: c.tracking_number,
          courier_name: 'UPS',
          courier_code: 'ups',
          status: normStatus,
          status_description: res.statusDescription,
          location: res.location,
          weight_kg: c.total_weight_kg,
          recipient_name: c.contact_name || c.company_name,
          recipient_postcode: c.postal_code,
          recipient_address: [c.address_line, c.city].filter(Boolean).join(', '),
          event_at: new Date().toISOString(),
        });

        // If the shipment is delivered or cancelled, mirror it directly onto the collections record status
        if (normStatus === 'delivered' || normStatus === 'cancelled') {
          await query(`UPDATE collections SET status = $1, updated_at = NOW() WHERE id = $2`, [normStatus, c.id]);
        }
        updated++;
      }
      // Small pause between UPS API requests
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.warn(`[ups-sync-track] Failed to sync tracking for ${c.tracking_number}:`, err.message);
    }
  }

  console.log(`📦 UPS collections tracking synced: ${updated}/${collections.length} package(s)`);
  return updated;
}
