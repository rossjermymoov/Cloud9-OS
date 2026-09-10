/**
 * Cloud9 OS — Morning Standup Service
 *
 * Pre-aggregates and provides executive-ready metrics for the daily 10-minute
 * morning management meeting:
 * 1. Yesterday's Output & Financial Volume (Parcels, Items, On-Time %)
 * 2. Warehouse Labor Health (Items/Hr, Active Pickers, Top Performer)
 * 3. Live Floor Queue & Pending Courier Collections
 * 4. Executive Red Flags & Commercial Anomalies (Surging queries, volume drops, carrier exceptions)
 */

import { query } from '../db/index.js';
import { holidaySet, isWorkingDay, lastWorkingBefore } from './bankHolidayService.js';
import { syncPicks } from './pickingService.js';
import { syncRecentOrders, syncStatusBoard, evaluateOrders, todayLondonYmd } from './slaService.js';

function isoDate(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${d.getDate()}`;
}

function safeItemsPerHour({ timedPicks, timedItems, totalMs }) {
  if (!timedPicks || Number(totalMs) <= 0) return null;
  const hours = Number(totalMs) / 3600000;
  if (hours <= 0) return null;
  const rate = Math.round(Number(timedItems) / hours);
  return rate > 0 && rate < 100000 ? rate : null;
}

function prettyCourier(name) {
  const n = (name || '').toLowerCase().replace(/[^a-z]/g, '');
  if (n.includes('royalmail')) return 'Royal Mail';
  if (n.includes('dpd')) return 'DPD';
  if (n.includes('dhl')) return 'DHL';
  if (n.includes('yodel')) return 'Yodel';
  if (n.includes('evri') || n.includes('hermes')) return 'Evri';
  if (n.includes('parcelforce')) return 'Parcelforce';
  if (n.includes('ups')) return 'UPS';
  if (n.includes('fedex')) return 'FedEx';
  if (n.includes('amazon')) return 'Amazon';
  return name || 'Other Couriers';
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
    // Exact same query as picking leaderboard
    const cRes = await query(
      `SELECT
        user_id,
        COALESCE(MAX(picker_name), 'Unknown')                         AS picker_name,
        COUNT(DISTINCT helm_pick_id)::int                             AS picks,
        COALESCE(SUM(items),0)::int                                   AS items,
        COALESCE(SUM(handling_ms),0)::bigint                          AS total_ms,
        COUNT(DISTINCT helm_pick_id) FILTER (WHERE handling_ms > 0)::int  AS timed_picks,
        COALESCE(SUM(items) FILTER (WHERE handling_ms > 0),0)::int    AS timed_items,
        COALESCE(SUM(item_scan_ms),0)::bigint                         AS item_scan_ms,
        COALESCE(SUM(item_scan_count),0)::int                         AS item_scan_count
      FROM pick_contributions
      WHERE pick_date = $1
      GROUP BY user_id
      ORDER BY items DESC`,
      [yesterdayStr]
    );

    let totItems = 0;
    let totMs = 0;
    let totPicks = 0;
    let totTimedPicks = 0;
    let totTimedItems = 0;

    const pickers = cRes.rows.map(r => {
      const items = parseInt(r.items) || 0;
      const ms = parseInt(r.total_ms) || 0;
      const pCount = parseInt(r.picks) || 0;
      const tPicks = parseInt(r.timed_picks) || 0;
      const tItems = parseInt(r.timed_items) || 0;

      totItems += items;
      totMs += ms;
      totPicks += pCount;
      totTimedPicks += tPicks;
      totTimedItems += tItems;

      const rate = safeItemsPerHour({ timedPicks: tPicks, timedItems: tItems, totalMs: ms });
      const hours = +(ms / 3600000).toFixed(1);

      return {
        name: r.picker_name || `User ${r.user_id}`,
        items,
        picks: pCount,
        rate,
        hours,
      };
    });

    // Fallback: If no contributions, check picks table directly
    if (totPicks === 0) {
      const pRes = await query(
        `SELECT COUNT(*)::int as count,
                COALESCE(SUM(item_count), 0)::int as items,
                COALESCE(SUM(handling_ms), 0)::bigint as handling_ms,
                COUNT(*) FILTER (WHERE handling_ms > 0)::int as timed_picks,
                COALESCE(SUM(item_count) FILTER (WHERE handling_ms > 0), 0)::int as timed_items
         FROM picks
         WHERE status = 1 AND pick_date = $1`,
        [yesterdayStr]
      );
      if (pRes.rows.length) {
        totPicks = parseInt(pRes.rows[0].count) || 0;
        totItems = parseInt(pRes.rows[0].items) || 0;
        totMs = parseInt(pRes.rows[0].handling_ms) || 0;
        totTimedPicks = parseInt(pRes.rows[0].timed_picks) || 0;
        totTimedItems = parseInt(pRes.rows[0].timed_items) || 0;
      }
    }

    const totalHours = Math.round((totMs / 3600000) * 10) / 10;
    const overallRate = safeItemsPerHour({ timedPicks: totTimedPicks, timedItems: totTimedItems, totalMs: totMs });

    pickingStats = {
      totalPicks: totPicks,
      totalItems: totItems,
      activePickers: pickers.length || (totPicks > 0 ? 1 : 0),
      totalHours,
      avgItemsPerHour: overallRate,
      topPicker: pickers.length > 0 ? pickers[0] : null,
      leaderboard: pickers.slice(0, 6),
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

  // ── 4. Today's Live Floor Queue & Status Pipeline ─────────────────────────
  let livePipeline = [];
  let totalOpenOrders = 0;
  try {
    const sbRes = await query(
      `SELECT status_id, name as status_name, count::int as order_count
       FROM status_board_counts
       WHERE count > 0
       ORDER BY count DESC`
    ).catch(() => ({ rows: [] }));

    if (sbRes.rows.length) {
      livePipeline = sbRes.rows.map(r => ({
        statusId: r.status_id,
        name: r.status_name,
        count: r.order_count,
      }));
      totalOpenOrders = livePipeline.reduce((a, b) => a + b.count, 0);
    }
  } catch (e) {
    console.warn('[standupService] live pipeline error:', e.message);
  }

  // ── 5. Couriers Awaiting Collection Today ─────────────────────────────────
  let courierCollections = [];
  let totalPendingParcels = 0;
  try {
    const tRes = await query(
      `SELECT courier_name, COUNT(*)::int as count
       FROM tracking_parcels
       WHERE status = 'booked'
       GROUP BY courier_name
       ORDER BY count DESC`
    );
    for (const r of tRes.rows) {
      const c = parseInt(r.count) || 0;
      totalPendingParcels += c;
      courierCollections.push({
        courier: prettyCourier(r.courier_name),
        count: c,
      });
    }
  } catch (e) {
    console.warn('[standupService] courier collections error:', e.message);
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
      totalPendingParcels,
      courierCollections,
      livePipeline,
      totalOpenOrders,
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
