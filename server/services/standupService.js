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
import { syncRecentOrders, syncStatusBoard, evaluateOrders, todayLondonYmd } from './slaService.js';

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
  if (typeof d === 'string') return d.slice(0, 10);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${d.getDate()}`;
}

/**
 * Get full morning standup summary data.
 */
export async function getStandupSummary() {
  const now = new Date();
  const hs = await holidaySet().catch(() => new Set());
  const todayStr = todayLondonYmd();

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
    // 1A. Customer volume snapshots (primary source of truth)
    const vRes = await query(
      `SELECT snapshot_date::text AS d,
              SUM(parcel_count)::int AS parcels,
              SUM(item_count)::int AS items
       FROM customer_volume_snapshots
       WHERE snapshot_date IN ($1, $2)
       GROUP BY snapshot_date`,
      [yesterdayStr, priorStr]
    );
    for (const r of vRes.rows) {
      const sDate = String(r.d).slice(0, 10);
      if (sDate === yesterdayStr) {
        yesterdayVolume.parcels = parseInt(r.parcels) || 0;
        yesterdayVolume.items = parseInt(r.items) || 0;
      } else if (sDate === priorStr) {
        priorVolume.parcels = parseInt(r.parcels) || 0;
        priorVolume.items = parseInt(r.items) || 0;
      }
    }

    // 1B. Fallback: Shipments table
    if (yesterdayVolume.parcels === 0) {
      const shRes = await query(
        `SELECT dispatched_at::text as d,
                SUM(parcel_count)::int as parcels,
                SUM(item_count)::int as items
         FROM shipments
         WHERE dispatched_at IN ($1, $2) AND cancelled = false
         GROUP BY dispatched_at`,
        [yesterdayStr, priorStr]
      );
      for (const r of shRes.rows) {
        const sDate = String(r.d).slice(0, 10);
        if (sDate === yesterdayStr && yesterdayVolume.parcels === 0) {
          yesterdayVolume.parcels = parseInt(r.parcels) || 0;
          yesterdayVolume.items = parseInt(r.items) || 0;
        } else if (sDate === priorStr && priorVolume.parcels === 0) {
          priorVolume.parcels = parseInt(r.parcels) || 0;
          priorVolume.items = parseInt(r.items) || 0;
        }
      }
    }

    // 1C. Fallback: Orders table
    if (yesterdayVolume.parcels === 0) {
      const oRes = await query(
        `SELECT (dispatched_at AT TIME ZONE 'Europe/London')::date::text as d,
                COUNT(*)::int as parcels,
                COALESCE(SUM(item_count), COUNT(*))::int as items
         FROM orders
         WHERE (dispatched_at AT TIME ZONE 'Europe/London')::date IN ($1, $2)
         GROUP BY 1`,
        [yesterdayStr, priorStr]
      );
      for (const r of oRes.rows) {
        const sDate = String(r.d).slice(0, 10);
        if (sDate === yesterdayStr && yesterdayVolume.parcels === 0) {
          yesterdayVolume.parcels = parseInt(r.parcels) || 0;
          yesterdayVolume.items = parseInt(r.items) || 0;
        } else if (sDate === priorStr && priorVolume.parcels === 0) {
          priorVolume.parcels = parseInt(r.parcels) || 0;
          priorVolume.items = parseInt(r.items) || 0;
        }
      }
    }
  } catch (e) {
    console.warn('[standupService] volume lookup error:', e.message);
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
              SUM(items)::int as items,
              SUM(handling_ms)::bigint as handling_ms,
              COUNT(DISTINCT helm_pick_id)::int as picks
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

    // Fallback: If no contributions, check picks table directly
    if (totPicks === 0) {
      const pRes = await query(
        `SELECT COUNT(*)::int as count,
                COALESCE(SUM(item_count), 0)::int as items,
                COALESCE(SUM(handling_ms), 0)::bigint as handling_ms,
                COUNT(DISTINCT picker_id)::int as pickers
         FROM picks
         WHERE status = 1 AND pick_date = $1`,
        [yesterdayStr]
      );
      if (pRes.rows.length) {
        totPicks = parseInt(pRes.rows[0].count) || 0;
        totItems = parseInt(pRes.rows[0].items) || 0;
        totMs = parseInt(pRes.rows[0].handling_ms) || 0;
      }
    }

    const totalHours = Math.round((totMs / 3600000) * 10) / 10;
    const overallRate = totalHours > 0.1 ? Math.round(totItems / totalHours) : null;

    pickingStats = {
      totalPicks: totPicks,
      totalItems: totItems,
      activePickers: pickers.length || (totPicks > 0 ? 1 : 0),
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
    const slaEval = await evaluateOrders({ fromYmd: yesterdayStr, toYmd: yesterdayStr });
    if (slaEval && slaEval.resolved > 0) {
      onTimeStats = {
        rate: slaEval.on_time_pct,
        breached: slaEval.breaches,
        total: slaEval.resolved,
      };
    } else {
      // Check 7d SLA if yesterday had no orders received
      const sla7d = await evaluateOrders({ fromYmd: priorStr, toYmd: yesterdayStr });
      if (sla7d && sla7d.resolved > 0) {
        onTimeStats = {
          rate: sla7d.on_time_pct,
          breached: sla7d.breaches,
          total: sla7d.resolved,
        };
      }
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
      `SELECT name as status_name, count as order_count, updated_at
       FROM status_board_counts
       ORDER BY count DESC`
    ).catch(() => ({ rows: [] }));

    if (sbRes.rows.length) {
      liveQueue.lastUpdated = sbRes.rows[0].updated_at;
      for (const r of sbRes.rows) {
        const name = String(r.status_name || '').toLowerCase();
        const cnt = parseInt(r.order_count) || 0;
        liveQueue.totalOpen += cnt;
        if (name.includes('unalloc') || name.includes('open') || name.includes('pending') || name.includes('import')) {
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
      `SELECT courier_name, COUNT(*)::int as count
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
      `SELECT COUNT(*)::int as count,
              COALESCE(SUM(total_quantity), 0)::int as units
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
      `SELECT COUNT(*)::int as exceptions
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
      `SELECT COUNT(*)::int as open_count,
              COUNT(*) FILTER (WHERE sla_status = 'breached')::int as breached_count
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
      `SELECT COUNT(*)::int as total_parcels
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
      `SELECT snapshot_date::text AS d,
              SUM(parcel_count)::int as parcels,
              SUM(item_count)::int as items
       FROM customer_volume_snapshots
       WHERE snapshot_date >= CURRENT_DATE - interval '21 days'
       GROUP BY snapshot_date
       ORDER BY snapshot_date ASC`
    );
    for (const r of t7Res.rows) {
      const dStr = String(r.d).slice(0, 10);
      const dObj = new Date(`${dStr}T00:00:00Z`);
      if (isWorkingDay(dStr, hs)) {
        trend7d.push({
          date: dStr,
          day: dObj.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }),
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
      dateFormatted: yesterdayDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }),
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
