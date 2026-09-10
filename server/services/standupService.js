/**
 * Cloud9 OS — Morning Standup Service
 *
 * Pre-aggregates and provides executive-ready metrics for the daily 10-minute
 * morning management meeting:
 * 1. Yesterday's Output & Financial Volume (Parcels, Items, On-Time %)
 * 2. Warehouse Labor Health (Items/Hr, Active Pickers, Top Performer)
 * 3. Live Floor Queue & Carrier Cut-off Deadlines (Royal Mail, DPD, DHL, etc.)
 * 4. Executive Red Flags & Commercial Anomalies (Surging queries, volume drops, carrier exceptions)
 */

import { query } from '../db/index.js';
import { holidaySet, isWorkingDay, lastWorkingBefore } from './bankHolidayService.js';
import { syncPicks } from './pickingService.js';
import { syncRecentOrders, syncStatusBoard } from './slaService.js';

// Default standard courier cut-off times (Europe/London time)
const DEFAULT_CUTOFFS = [
  { courier: 'Royal Mail', code: 'royalmail', cutoff: '15:30' },
  { courier: 'DPD', code: 'dpd', cutoff: '16:30' },
  { courier: 'DHL', code: 'dhl', cutoff: '17:00' },
  { courier: 'Evri', code: 'evri', cutoff: '16:00' },
  { courier: 'UPS', code: 'ups', cutoff: '17:30' },
  { courier: 'FedEx', code: 'fedex', cutoff: '16:30' },
  { courier: 'Yodel', code: 'yodel', cutoff: '16:00' },
];

function isoDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Get full morning standup summary data.
 */
export async function getStandupSummary() {
  const now = new Date();
  const hs = await holidaySet();
  const todayStr = isoDate(now);

  // Get yesterday / last working day
  const yesterdayStr = lastWorkingBefore(todayStr, hs);
  const yesterdayDate = new Date(`${yesterdayStr}T00:00:00Z`);

  // Get day before yesterday (for comparison)
  const priorStr = lastWorkingBefore(yesterdayStr, hs);
  const priorDate = new Date(`${priorStr}T00:00:00Z`);

  // ── 1. Yesterday Volume & Dispatches ──────────────────────────────────────
  let yesterdayVolume = { parcels: 0, items: 0, picks: 0 };
  let priorVolume = { parcels: 0, items: 0, picks: 0 };

  try {
    const vRes = await query(
      `SELECT snapshot_date,
              SUM(parcels) as parcels,
              SUM(items) as items
       FROM customer_volume_snapshots
       WHERE snapshot_date IN ($1, $2)
       GROUP BY snapshot_date`,
      [yesterdayStr, priorStr]
    );
    for (const r of vRes.rows) {
      const sDate = r.snapshot_date instanceof Date ? isoDate(r.snapshot_date) : String(r.snapshot_date).slice(0, 10);
      if (sDate === yesterdayStr) {
        yesterdayVolume.parcels = parseInt(r.parcels) || 0;
        yesterdayVolume.items = parseInt(r.items) || 0;
      } else if (sDate === priorStr) {
        priorVolume.parcels = parseInt(r.parcels) || 0;
        priorVolume.items = parseInt(r.items) || 0;
      }
    }
  } catch (e) {
    console.warn('[standupService] volume lookup error:', e.message);
  }

  // Fallback: Check orders table if customer_volume_snapshots has no data for yesterday
  if (yesterdayVolume.parcels === 0) {
    try {
      const oRes = await query(
        `SELECT COUNT(*) as parcels,
                COALESCE(SUM(total_items), COUNT(*)) as items
         FROM orders
         WHERE DATE(dispatched_at AT TIME ZONE 'Europe/London') = $1`,
        [yesterdayStr]
      );
      if (oRes.rows.length) {
        yesterdayVolume.parcels = parseInt(oRes.rows[0].parcels) || 0;
        yesterdayVolume.items = parseInt(oRes.rows[0].items) || 0;
      }
    } catch {}
  }

  // ── 2. Picking & Labor Productivity for Yesterday ────────────────────────
  let pickingStats = {
    totalPicks: 0,
    totalItems: 0,
    activePickers: 0,
    totalHours: 0,
    avgItemsPerHour: null,
    topPicker: null,
    leaderboard: [],
  };

  try {
    // Pick contributions for yesterday
    const cRes = await query(
      `SELECT picker_name, user_id,
              SUM(items) as items,
              SUM(handling_ms) as handling_ms,
              COUNT(DISTINCT helm_pick_id) as picks
       FROM pick_contributions
       WHERE pick_date = $1
       GROUP BY picker_name, user_id
       ORDER BY items DESC`,
      [yesterdayStr]
    );

    let totItems = 0;
    let totMs = 0;
    let totPicks = 0;
    const pickers = [];

    for (const r of cRes.rows) {
      const items = parseInt(r.items) || 0;
      const ms = parseInt(r.handling_ms) || 0;
      const pCount = parseInt(r.picks) || 0;
      totItems += items;
      totMs += ms;
      totPicks += pCount;

      const hrs = ms / 3600000;
      const rate = hrs > 0.05 ? Math.round(items / hrs) : null;
      pickers.push({
        name: r.picker_name || `User ${r.user_id}`,
        items,
        picks: pCount,
        rate,
        hours: Math.round(hrs * 10) / 10,
      });
    }

    const totalHours = Math.round((totMs / 3600000) * 10) / 10;
    const overallRate = totalHours > 0.1 ? Math.round(totItems / totalHours) : null;

    pickingStats = {
      totalPicks: totPicks,
      totalItems: totItems,
      activePickers: pickers.length,
      totalHours,
      avgItemsPerHour: overallRate,
      topPicker: pickers.length > 0 ? pickers[0] : null,
      leaderboard: pickers.slice(0, 5),
    };
    yesterdayVolume.picks = totPicks;
  } catch (e) {
    console.warn('[standupService] picking stats error:', e.message);
  }

  // ── 3. On-Time Dispatch SLA for Yesterday ────────────────────────────────
  let onTimeStats = { rate: null, breached: 0, total: 0 };
  try {
    const slaRes = await query(
      `SELECT
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE on_time = true) as on_time_count,
         COUNT(*) FILTER (WHERE on_time = false) as breach_count
       FROM sla_order_performance
       WHERE DATE(order_date) = $1`,
      [yesterdayStr]
    );
    if (slaRes.rows.length && parseInt(slaRes.rows[0].total) > 0) {
      const tot = parseInt(slaRes.rows[0].total);
      const ot = parseInt(slaRes.rows[0].on_time_count) || 0;
      const br = parseInt(slaRes.rows[0].breach_count) || 0;
      onTimeStats = {
        rate: Math.round((ot / tot) * 1000) / 10,
        breached: br,
        total: tot,
      };
    }
  } catch (e) {
    console.warn('[standupService] SLA stats error:', e.message);
  }

  // ── 4. Today's Live Floor Queue & Status Board ───────────────────────────
  let liveQueue = {
    unallocated: 0,
    picking: 0,
    packing: 0,
    readyToShip: 0,
    totalOpen: 0,
    lastUpdated: null,
  };

  try {
    const sbRes = await query(
      `SELECT status_name, order_count, updated_at
       FROM status_board_snapshots
       ORDER BY updated_at DESC`
    );
    if (sbRes.rows.length) {
      liveQueue.lastUpdated = sbRes.rows[0].updated_at;
      for (const r of sbRes.rows) {
        const name = String(r.status_name || '').toLowerCase();
        const cnt = parseInt(r.order_count) || 0;
        liveQueue.totalOpen += cnt;
        if (name.includes('unalloc') || name.includes('open') || name.includes('pending')) {
          liveQueue.unallocated += cnt;
        } else if (name.includes('pick')) {
          liveQueue.picking += cnt;
        } else if (name.includes('pack')) {
          liveQueue.packing += cnt;
        } else if (name.includes('ready') || name.includes('booked')) {
          liveQueue.readyToShip += cnt;
        }
      }
    }
  } catch (e) {
    console.warn('[standupService] live queue error:', e.message);
  }

  // ── 5. Pending Carrier Collections & Cut-off Deadlines ───────────────────
  let carrierPending = [];
  let totalPendingCollection = 0;
  try {
    const tRes = await query(
      `SELECT courier_name, COUNT(*) as count
       FROM tracking_parcels
       WHERE status = 'booked'
       GROUP BY courier_name
       ORDER BY count DESC`
    );
    const countMap = new Map();
    for (const r of tRes.rows) {
      const c = parseInt(r.count) || 0;
      totalPendingCollection += c;
      const key = String(r.courier_name || '').toLowerCase().replace(/[^a-z]/g, '');
      countMap.set(key, c);
    }

    // Compute cutoff countdowns
    const ukTimeStr = now.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false });
    const [curH, curM] = ukTimeStr.split(':').map(Number);
    const curMinutes = curH * 60 + curM;

    carrierPending = DEFAULT_CUTOFFS.map(c => {
      const [coH, coM] = c.cutoff.split(':').map(Number);
      const coMinutes = coH * 60 + coM;
      const diffMins = coMinutes - curMinutes;
      const isPast = diffMins <= 0;

      let matchedCount = 0;
      for (const [k, v] of countMap.entries()) {
        if (k.includes(c.code)) matchedCount += v;
      }

      let remainingLabel = '';
      if (isPast) {
        remainingLabel = 'Cutoff passed';
      } else {
        const hrs = Math.floor(diffMins / 60);
        const mins = diffMins % 60;
        remainingLabel = hrs > 0 ? `${hrs}h ${mins}m left` : `${mins}m left`;
      }

      return {
        courier: c.courier,
        cutoff: c.cutoff,
        pending: matchedCount,
        isPast,
        remainingLabel,
        diffMins,
      };
    }).sort((a, b) => a.diffMins - b.diffMins);
  } catch (e) {
    console.warn('[standupService] carrier pending error:', e.message);
  }

  // ── 6. Expected Inbound Purchase Orders ──────────────────────────────────
  let inboundPOs = { count: 0, pendingBoxes: 0, pendingUnits: 0 };
  try {
    const poRes = await query(
      `SELECT COUNT(*) as count,
              COALESCE(SUM(total_quantity), 0) as units
       FROM purchase_orders
       WHERE status_name NOT ILIKE '%complete%' AND status_name NOT ILIKE '%cancel%'`
    );
    if (poRes.rows.length) {
      inboundPOs = {
        count: parseInt(poRes.rows[0].count) || 0,
        pendingUnits: parseInt(poRes.rows[0].units) || 0,
      };
    }
  } catch {}

  // ── 7. Red Flags & Commercial Anomalies ──────────────────────────────────
  const redFlags = [];

  // A. Carrier Exceptions
  try {
    const exRes = await query(
      `SELECT COUNT(*) as exceptions
       FROM tracking_parcels
       WHERE status IN ('failed_delivery', 'exception', 'damaged', 'on_hold')`
    );
    const excCount = parseInt(exRes.rows[0]?.exceptions) || 0;
    if (excCount > 0) {
      redFlags.push({
        type: 'carrier_exceptions',
        severity: excCount > 20 ? 'red' : 'amber',
        title: `${excCount} Carrier Delivery Exception${excCount === 1 ? '' : 's'}`,
        description: 'Parcels currently encountering delivery failures, address issues or carrier damage.',
        link: '/tracking?status=exception',
      });
    }
  } catch {}

  // B. Open Queries / SLA Breaches
  try {
    const qRes = await query(
      `SELECT COUNT(*) as open_count,
              COUNT(*) FILTER (WHERE sla_status = 'breached') as breached_count
       FROM queries
       WHERE status NOT IN ('resolved', 'closed')`
    );
    const openQ = parseInt(qRes.rows[0]?.open_count) || 0;
    const breachedQ = parseInt(qRes.rows[0]?.breached_count) || 0;
    if (breachedQ > 0) {
      redFlags.push({
        type: 'query_breach',
        severity: 'red',
        title: `${breachedQ} Client Support Query SLA Breach${breachedQ === 1 ? '' : 'es'}`,
        description: `${openQ} active customer queries, of which ${breachedQ} have exceeded resolution deadlines.`,
        link: '/queries?filter=breached',
      });
    } else if (openQ > 15) {
      redFlags.push({
        type: 'query_volume',
        severity: 'amber',
        title: `${openQ} Open Support Queries`,
        description: 'Customer service inbox volume is elevated.',
        link: '/queries',
      });
    }
  } catch {}

  // C. Unattributed Parcels Warning
  try {
    const uRes = await query(
      `SELECT COUNT(*) as total_parcels
       FROM tracking_parcels
       WHERE (customer_id IS NULL OR client_id IS NULL)
         AND created_at >= NOW() - interval '14 days'`
    );
    const unattrCount = parseInt(uRes.rows[0]?.total_parcels) || 0;
    if (unattrCount > 50) {
      redFlags.push({
        type: 'unattributed_parcels',
        severity: 'amber',
        title: `${unattrCount} Unattributed Parcels (Last 14d)`,
        description: 'Parcels without matched client account IDs are missing from client billing snapshots.',
        link: '/',
      });
    }
  } catch {}

  // ── 8. Last 7 Working Days Trend Sparkline ────────────────────────────────
  const trend7d = [];
  try {
    const t7Res = await query(
      `SELECT snapshot_date,
              SUM(parcels) as parcels,
              SUM(items) as items
       FROM customer_volume_snapshots
       WHERE snapshot_date >= CURRENT_DATE - interval '14 days'
       GROUP BY snapshot_date
       ORDER BY snapshot_date ASC`
    );
    for (const r of t7Res.rows) {
      const dStr = r.snapshot_date instanceof Date ? isoDate(r.snapshot_date) : String(r.snapshot_date).slice(0, 10);
      const dObj = new Date(dStr);
      if (isWorkingDay(dStr, hs)) {
        trend7d.push({
          date: dStr,
          day: dObj.toLocaleDateString('en-GB', { weekday: 'short' }),
          parcels: parseInt(r.parcels) || 0,
          items: parseInt(r.items) || 0,
        });
      }
    }
  } catch {}

  // Percentage calculations
  const parcelDiffPct = priorVolume.parcels > 0
    ? Math.round(((yesterdayVolume.parcels - priorVolume.parcels) / priorVolume.parcels) * 1000) / 10
    : null;
  const itemDiffPct = priorVolume.items > 0
    ? Math.round(((yesterdayVolume.items - priorVolume.items) / priorVolume.items) * 1000) / 10
    : null;

  return {
    yesterday: {
      dateStr: yesterdayStr,
      dateFormatted: yesterdayDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }),
      parcels: yesterdayVolume.parcels,
      items: yesterdayVolume.items,
      picks: yesterdayVolume.picks,
      parcelDiffPct,
      itemDiffPct,
      priorParcels: priorVolume.parcels,
      priorItems: priorVolume.items,
      onTimePct: onTimeStats.rate,
      onTimeBreaches: onTimeStats.breached,
      pickingStats,
    },
    todayLive: {
      totalPendingCollection,
      carrierCutoffs: carrierPending,
      liveQueue,
      inboundPOs,
      currentTimeUk: now.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }),
    },
    redFlags,
    trend7d: trend7d.slice(-7),
  };
}

/**
 * Execute full morning pre-computation sync (called at 06:00 UK).
 */
export async function runMorningPrecompute() {
  console.log('🌅 Starting 06:00 AM Morning Standup pre-computation...');
  try {
    await syncPicks(3, { pickDelayMs: 50 }).catch(() => {});
    await syncRecentOrders(7).catch(() => {});
    await syncStatusBoard().catch(() => {});
    console.log('✅ 06:00 AM Morning Standup pre-computation complete.');
    return { success: true, timestamp: new Date().toISOString() };
  } catch (err) {
    console.error('❌ Morning Standup pre-computation failed:', err.message);
    return { success: false, error: err.message };
  }
}
