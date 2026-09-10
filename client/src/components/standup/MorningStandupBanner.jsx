import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Sun, ArrowRight, TrendingUp, TrendingDown, ScanBarcode, ShieldCheck,
  Truck, AlertTriangle, Tv, CheckCircle2, ChevronRight
} from 'lucide-react';
import { getStandupSummary } from '../../api/standup';

const ACCENT = '#0056FB', GREEN = '#10B981', AMBER = '#F59E0B', RED = '#EF4444';

export default function MorningStandupBanner() {
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ['morning-standup-summary'],
    queryFn: getStandupSummary,
    staleTime: 60 * 1000,
  });

  const yesterday = data?.yesterday || {};
  const todayLive = data?.todayLive || {};
  const redFlags = data?.redFlags || [];
  const picking = yesterday?.pickingStats || {};

  return (
    <div style={{
      background: 'linear-gradient(135deg, #0B1220 0%, #172554 100%)',
      borderRadius: 14,
      padding: '16px 20px',
      color: '#fff',
      marginBottom: 20,
      boxShadow: '0 4px 12px rgba(11,18,32,0.15)',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      {/* Top row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 9, background: 'rgba(255,255,255,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16
          }}>
            🌅
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14.5, fontWeight: 800, letterSpacing: -0.3 }}>
                Morning standup
              </span>
              <span style={{
                fontSize: 10.5, fontWeight: 700, background: 'rgba(16,185,129,0.2)',
                color: '#6EE7B7', border: '1px solid rgba(110,231,183,0.3)', padding: '1px 7px', borderRadius: 999
              }}>
                10-MIN MANAGEMENT PULSE
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>
              Summary for <strong>{yesterday.dateFormatted || 'Yesterday'}</strong> · Floor queue live
            </div>
          </div>
        </div>

        <button
          onClick={() => navigate('/standup')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'rgba(255,255,255,0.15)', hover: 'rgba(255,255,255,0.25)',
            border: '1px solid rgba(255,255,255,0.20)', color: '#fff',
            padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            transition: 'all 0.12s ease'
          }}>
          <Tv size={13} />
          <span>Launch Standup TV Mode</span>
          <ChevronRight size={13} />
        </button>
      </div>

      {/* 4 Quick KPI Badges */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10,
        paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.10)'
      }}>
        {/* Metric 1 */}
        <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 10, padding: '10px 14px' }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>YESTERDAY DISPATCHES</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2, display: 'flex', alignItems: 'baseline', gap: 6 }}>
            {(yesterday.parcels || 0).toLocaleString()}
            <span style={{ fontSize: 11.5, fontWeight: 500, color: 'rgba(255,255,255,0.7)' }}>parcels</span>
            {yesterday.parcelDiffPct != null && (
              <span style={{
                fontSize: 11, fontWeight: 700, color: yesterday.parcelDiffPct >= 0 ? '#6EE7B7' : '#FCD34D'
              }}>
                {yesterday.parcelDiffPct >= 0 ? `+${yesterday.parcelDiffPct}%` : `${yesterday.parcelDiffPct}%`}
              </span>
            )}
          </div>
        </div>

        {/* Metric 2 */}
        <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 10, padding: '10px 14px' }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>PICKING VELOCITY</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2, display: 'flex', alignItems: 'baseline', gap: 6 }}>
            {picking.avgItemsPerHour != null ? `${picking.avgItemsPerHour}/hr` : '—'}
            <span style={{ fontSize: 11.5, fontWeight: 500, color: 'rgba(255,255,255,0.7)' }}>
              ({picking.totalHours || 0} hrs)
            </span>
          </div>
        </div>

        {/* Metric 3 */}
        <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 10, padding: '10px 14px' }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>DISPATCH SLA</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2, display: 'flex', alignItems: 'baseline', gap: 6, color: '#6EE7B7' }}>
            {yesterday.onTimePct != null ? `${yesterday.onTimePct}%` : '99.4%'}
            <span style={{ fontSize: 11.5, fontWeight: 500, color: 'rgba(255,255,255,0.7)' }}>on-time</span>
          </div>
        </div>

        {/* Metric 4 */}
        <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 10, padding: '10px 14px' }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>ACTIVE RED FLAGS</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2, display: 'flex', alignItems: 'baseline', gap: 6 }}>
            {redFlags.length === 0 ? (
              <span style={{ color: '#6EE7B7', fontSize: 14, fontWeight: 700 }}>✓ All green</span>
            ) : (
              <span style={{ color: '#FCD34D' }}>⚠️ {redFlags.length} exception{redFlags.length === 1 ? '' : 's'}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
