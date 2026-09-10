import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Sun, Moon, RefreshCw, Send, Boxes, ScanBarcode, Clock, Award,
  AlertTriangle, ShieldCheck, Truck, PackageCheck, Flame, ChevronRight,
  TrendingUp, TrendingDown, Minus, Tv, Maximize, ArrowUpRight, CheckCircle2,
  Calendar, Layers, Inbox, AlertCircle
} from 'lucide-react';
import { getStandupSummary, refreshStandupSummary } from '../../api/standup';

const HEADER = '#0B1220', TITLE = '#0F172A', MUTED = '#64748B', ACCENT = '#0056FB';
const GREEN = '#10B981', AMBER = '#F59E0B', RED = '#EF4444';
const SHADOW = '0 1px 3px rgba(16,24,40,0.06), 0 1px 4px rgba(16,24,40,0.08)';

export default function MorningStandupPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tvMode, setTvMode] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(new Date());

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['morning-standup-summary'],
    queryFn: getStandupSummary,
    refetchInterval: 60 * 1000, // auto-refresh every 60s in standup meeting
  });

  useEffect(() => {
    if (data) setLastRefreshedAt(new Date());
  }, [data]);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshStandupSummary();
      await refetch();
      qc.invalidateQueries({ queryKey: ['volume-trend'] });
      qc.invalidateQueries({ queryKey: ['tracking-stats'] });
      qc.invalidateQueries({ queryKey: ['picking'] });
    } catch (e) {
      console.warn('Refresh error:', e);
    } finally {
      setIsRefreshing(false);
    }
  };

  const yesterday = data?.yesterday || {};
  const todayLive = data?.todayLive || {};
  const redFlags = data?.redFlags || [];
  const trend7d = data?.trend7d || [];
  const picking = yesterday?.pickingStats || {};
  const queue = todayLive?.liveQueue || {};
  const cutoffs = todayLive?.carrierCutoffs || [];

  const maxTrend = Math.max(...trend7d.map(d => d.parcels), 1);

  // Background and Theme styles for Normal vs TV Mode
  const bg = tvMode ? '#0A0F1D' : '#F8FAFC';
  const cardBg = tvMode ? '#131B2E' : '#FFFFFF';
  const cardBorder = tvMode ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(16,24,40,0.06)';
  const textPrimary = tvMode ? '#FFFFFF' : TITLE;
  const textMuted = tvMode ? '#94A3B8' : MUTED;
  const statBg = tvMode ? 'rgba(255,255,255,0.04)' : '#F8FAFC';

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 14 }}>
        <RefreshCw size={28} className="animate-spin text-blue-600" style={{ animation: 'spin 1s linear infinite' }} />
        <div style={{ fontSize: 15, fontWeight: 600, color: TITLE }}>Preparing Morning Standup Command Deck…</div>
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: bg, margin: tvMode ? '-24px' : '0', padding: tvMode ? '28px 36px' : '0 0 40px', transition: 'all 0.2s ease' }}>
      {/* ── Top Header / Standup Bar ────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22, flexWrap: 'wrap', gap: 14 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 24 }}>🌅</span>
            <h1 style={{ fontSize: tvMode ? 28 : 24, fontWeight: 800, color: textPrimary, margin: 0, letterSpacing: -0.6 }}>
              Morning standup
            </h1>
            <span style={{ fontSize: 11.5, fontWeight: 700, background: '#ECFDF5', color: '#047857', border: '1px solid #A7F3D0', padding: '3px 9px', borderRadius: 999 }}>
              10-MIN MANAGEMENT VIEW
            </span>
          </div>
          <p style={{ fontSize: 13, color: textMuted, margin: '4px 0 0' }}>
            Daily executive pulse: Output for <strong>{yesterday.dateFormatted || 'Yesterday'}</strong> · Floor queue as of <strong>{todayLive.currentTimeUk || '08:30'} UK</strong>
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => setTvMode(t => !t)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 13px', borderRadius: 9,
              border: cardBorder, background: tvMode ? ACCENT : cardBg, color: tvMode ? '#fff' : textPrimary,
              fontSize: 12.5, fontWeight: 600, cursor: 'pointer', boxShadow: SHADOW
            }}>
            <Tv size={14} />
            <span>{tvMode ? 'Exit TV Mode' : 'TV / Projector Mode'}</span>
          </button>

          <button
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 13px', borderRadius: 9,
              border: cardBorder, background: cardBg, color: textPrimary,
              fontSize: 12.5, fontWeight: 600, cursor: isRefreshing ? 'default' : 'pointer', boxShadow: SHADOW,
              opacity: isRefreshing ? 0.7 : 1
            }}>
            <RefreshCw size={14} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} />
            <span>{isRefreshing ? 'Re-syncing…' : 'Sync Now'}</span>
          </button>
        </div>
      </div>

      {/* ── 4 High-Impact Morning Pillars ──────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginBottom: 20 }}>
        {/* PILLAR 1: Output */}
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 18, boxShadow: SHADOW }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              1. Yesterday Output
            </span>
            <Send size={16} color={ACCENT} />
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, color: textPrimary, letterSpacing: -1, lineHeight: 1 }}>
            {(yesterday.parcels || 0).toLocaleString()}
            <span style={{ fontSize: 14, fontWeight: 600, color: textMuted, marginLeft: 6 }}>parcels</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: textMuted, marginTop: 4 }}>
            {(yesterday.items || 0).toLocaleString()} <span style={{ fontSize: 12, fontWeight: 500 }}>units dispatched</span>
          </div>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            {yesterday.parcelDiffPct != null && (
              <span style={{
                fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                background: yesterday.parcelDiffPct >= 0 ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)',
                color: yesterday.parcelDiffPct >= 0 ? GREEN : AMBER, display: 'inline-flex', alignItems: 'center', gap: 3
              }}>
                {yesterday.parcelDiffPct >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {yesterday.parcelDiffPct >= 0 ? `+${yesterday.parcelDiffPct}%` : `${yesterday.parcelDiffPct}%`} vs prev day
              </span>
            )}
            <span style={{ fontSize: 11.5, color: textMuted }}>({(yesterday.priorParcels || 0).toLocaleString()} prior)</span>
          </div>
        </div>

        {/* PILLAR 2: Labor Productivity */}
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 18, boxShadow: SHADOW }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              2. Warehouse Labor Rate
            </span>
            <ScanBarcode size={16} color="#7B2FBE" />
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, color: textPrimary, letterSpacing: -1, lineHeight: 1 }}>
            {picking.avgItemsPerHour != null ? picking.avgItemsPerHour : '—'}
            <span style={{ fontSize: 14, fontWeight: 600, color: textMuted, marginLeft: 6 }}>items / hr</span>
          </div>
          <div style={{ fontSize: 13, color: textMuted, marginTop: 4 }}>
            <strong>{picking.totalHours || 0} hrs</strong> active picking across <strong>{picking.activePickers || 0} pickers</strong>
          </div>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            {picking.topPicker ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(123,47,190,0.10)', color: '#7B2FBE', padding: '2px 8px', borderRadius: 6, fontWeight: 700 }}>
                🏆 Top: {picking.topPicker.name} ({picking.topPicker.items} items)
              </span>
            ) : (
              <span style={{ color: textMuted }}>No pick logs for yesterday</span>
            )}
          </div>
        </div>

        {/* PILLAR 3: On-Time SLA */}
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 18, boxShadow: SHADOW }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              3. Dispatch SLA Health
            </span>
            <ShieldCheck size={16} color={GREEN} />
          </div>
          <div style={{
            fontSize: 32, fontWeight: 800,
            color: yesterday.onTimePct != null
              ? (yesterday.onTimePct >= 99.0 ? GREEN : (yesterday.onTimePct >= 95.0 ? AMBER : RED))
              : GREEN,
            letterSpacing: -1, lineHeight: 1
          }}>
            {yesterday.onTimePct != null ? `${yesterday.onTimePct}%` : '100%'}
            <span style={{ fontSize: 14, fontWeight: 600, color: textMuted, marginLeft: 6 }}>on-time</span>
          </div>
          <div style={{ fontSize: 13, color: textMuted, marginTop: 4 }}>
            {yesterday.onTimeBreaches > 0 ? (
              <span style={{ color: RED, fontWeight: 700 }}>⚠️ {yesterday.onTimeBreaches} order(s) breached cut-off</span>
            ) : (
              <span style={{ color: GREEN, fontWeight: 600 }}>✓ Zero cut-off breaches recorded</span>
            )}
          </div>
          <div style={{ marginTop: 12, fontSize: 11.5, color: textMuted }}>
            Target: 99.0% on-time dispatch agreement
          </div>
        </div>

        {/* PILLAR 4: Live Backlog */}
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 18, boxShadow: SHADOW }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              4. Floor Backlog Today
            </span>
            <PackageCheck size={16} color="#00BCD4" />
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, color: textPrimary, letterSpacing: -1, lineHeight: 1 }}>
            {(queue.totalOpen || queue.unallocated || todayLive.totalPendingCollection || 0).toLocaleString()}
            <span style={{ fontSize: 14, fontWeight: 600, color: textMuted, marginLeft: 6 }}>orders active</span>
          </div>
          <div style={{ fontSize: 13, color: textMuted, marginTop: 4 }}>
            <strong>{todayLive.totalPendingCollection || 0}</strong> parcels booked awaiting carrier collection
          </div>
          <div style={{ marginTop: 12, fontSize: 11.5, color: textMuted }}>
            {todayLive.inboundPOs?.count > 0 ? (
              <span>📦 {todayLive.inboundPOs.count} inbound POs scheduled ({todayLive.inboundPOs.pendingUnits.toLocaleString()} units)</span>
            ) : (
              <span>Inbound docks clear</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Middle Grid: Cut-offs & Carrier Radar + Red Flags ─────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16, marginBottom: 20 }}>
        {/* CARRIER COLLECTION COUNTDOWN RADAR */}
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 20, boxShadow: SHADOW }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Truck size={17} color={ACCENT} />
              <span style={{ fontSize: 14.5, fontWeight: 700, color: textPrimary }}>Carrier Cut-Off Deadlines &amp; Collections</span>
            </div>
            <span style={{ fontSize: 11.5, color: textMuted }}>Live for today</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {cutoffs.map((c, i) => {
              const isUrgent = !c.isPast && c.diffMins <= 90;
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 12px', borderRadius: 9, background: statBg,
                  border: isUrgent ? '1px solid #FCD34D' : '1px solid rgba(0,0,0,0.03)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: c.isPast ? '#94A3B8' : (isUrgent ? AMBER : GREEN)
                    }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: textPrimary }}>{c.courier}</div>
                      <div style={{ fontSize: 11, color: textMuted }}>Cut-off: <strong>{c.cutoff}</strong></div>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: textPrimary }}>
                      {c.pending} <span style={{ fontSize: 11, fontWeight: 500, color: textMuted }}>parcels</span>
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: c.isPast ? '#94A3B8' : (isUrgent ? AMBER : GREEN) }}>
                      {c.remainingLabel}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* MORNING ACTION ITEMS & RED FLAGS */}
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 20, boxShadow: SHADOW }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={17} color={redFlags.length > 0 ? AMBER : GREEN} />
              <span style={{ fontSize: 14.5, fontWeight: 700, color: textPrimary }}>Executive Red Flags &amp; Exceptions</span>
            </div>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 6,
              background: redFlags.length > 0 ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)',
              color: redFlags.length > 0 ? RED : GREEN
            }}>
              {redFlags.length} active
            </span>
          </div>

          {redFlags.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '36px 16px', textAlign: 'center' }}>
              <CheckCircle2 size={32} color={GREEN} style={{ marginBottom: 8 }} />
              <div style={{ fontSize: 14, fontWeight: 700, color: textPrimary }}>All operational signals green</div>
              <div style={{ fontSize: 12, color: textMuted, maxWidth: 280, marginTop: 2 }}>
                Zero active delivery spikes, SLA breaches, or customer claim bottlenecks.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {redFlags.map((rf, idx) => (
                <div key={idx} onClick={() => rf.link && navigate(rf.link)} style={{
                  padding: '12px 14px', borderRadius: 9, cursor: rf.link ? 'pointer' : 'default',
                  background: rf.severity === 'red' ? 'rgba(239,68,68,0.06)' : 'rgba(245,158,11,0.06)',
                  border: rf.severity === 'red' ? '1px solid rgba(239,68,68,0.2)' : '1px solid rgba(245,158,11,0.2)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: rf.severity === 'red' ? RED : AMBER }}>
                      {rf.title}
                    </div>
                    {rf.link && <ArrowUpRight size={14} color={rf.severity === 'red' ? RED : AMBER} />}
                  </div>
                  <div style={{ fontSize: 12, color: textMuted, marginTop: 3 }}>
                    {rf.description}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom Grid: 7-Day Velocity Trend & Top Pickers ────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
        {/* 7-DAY DISPATCH PULSE */}
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 20, boxShadow: SHADOW }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <TrendingUp size={17} color={ACCENT} />
              <span style={{ fontSize: 14.5, fontWeight: 700, color: textPrimary }}>7-Day Working Day Output Trend</span>
            </div>
            <span style={{ fontSize: 11.5, color: textMuted }}>Daily volume pulse</span>
          </div>

          {trend7d.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12.5, color: textMuted }}>No trend data recorded.</div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 140, paddingTop: 10 }}>
              {trend7d.map((t, idx) => {
                const h = Math.round((t.parcels / maxTrend) * 105) + 6;
                const isYesterday = t.date === yesterday.dateStr;
                return (
                  <div key={idx} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: textPrimary }}>{t.parcels}</span>
                    <div style={{
                      width: '100%', maxWidth: 36, height: h, borderRadius: '5px 5px 0 0',
                      background: isYesterday ? ACCENT : (tvMode ? '#2563EB' : '#93C5FD'),
                      border: isYesterday ? '2px solid #fff' : 'none',
                      transition: 'all 0.15s ease'
                    }} />
                    <span style={{ fontSize: 10.5, fontWeight: isYesterday ? 700 : 500, color: isYesterday ? ACCENT : textMuted }}>
                      {t.day}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* WAREHOUSE TOP PERFORMERS */}
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 14, padding: 20, boxShadow: SHADOW }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Award size={17} color="#F59E0B" />
              <span style={{ fontSize: 14.5, fontWeight: 700, color: textPrimary }}>Picker Velocity Standup Board</span>
            </div>
            <span onClick={() => navigate('/picking')} style={{ fontSize: 12, color: ACCENT, cursor: 'pointer', fontWeight: 600 }}>
              Full picking board →
            </span>
          </div>

          {(!picking.leaderboard || picking.leaderboard.length === 0) ? (
            <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12.5, color: textMuted }}>No picker contributions logged for yesterday.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ color: textMuted, textAlign: 'left', fontSize: 11, borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                  <th style={{ padding: '6px 4px' }}>#</th>
                  <th style={{ padding: '6px 4px' }}>Picker</th>
                  <th style={{ padding: '6px 4px', textAlign: 'right' }}>Items</th>
                  <th style={{ padding: '6px 4px', textAlign: 'right' }}>Waves</th>
                  <th style={{ padding: '6px 4px', textAlign: 'right', color: GREEN }}>Rate (items/hr)</th>
                </tr>
              </thead>
              <tbody>
                {picking.leaderboard.map((p, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid rgba(0,0,0,0.03)' }}>
                    <td style={{ padding: '8px 4px', fontWeight: 700, color: idx === 0 ? '#F59E0B' : textMuted }}>
                      {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                    </td>
                    <td style={{ padding: '8px 4px', fontWeight: 600, color: textPrimary }}>{p.name}</td>
                    <td style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 700, color: textPrimary }}>{p.items}</td>
                    <td style={{ padding: '8px 4px', textAlign: 'right', color: textMuted }}>{p.picks}</td>
                    <td style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 800, color: p.rate ? GREEN : textMuted }}>
                      {p.rate ? `${p.rate}/hr` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
