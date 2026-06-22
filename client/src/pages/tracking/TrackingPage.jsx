/**
 * TrackingPage — Global parcel tracking view
 * Stats · Filters · Search · Live parcel table · Event timeline drawer
 */

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Search, X, Truck, PackageCheck, Clock, AlertTriangle,
  ShieldAlert, RotateCcw, Package, ChevronRight, MapPin,
  RefreshCw, Store, Calendar, Plane, PackageX,
  Warehouse, OctagonX, Navigation,
} from 'lucide-react';
import axios from 'axios';
import { startOfDay, endOfDay, startOfMonth, subDays, format } from 'date-fns';
import { getCourierLogo } from '../../utils/courierLogos';
import { getAuthToken } from '../../context/AuthContext';

const api = axios.create({ baseURL: '/api' });
// Attach the login token — tracking endpoints now require auth.
api.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Small inline logo for table rows / drawer
function CourierBadge({ name, code }) {
  const logo = getCourierLogo(code) || getCourierLogo(name);
  if (logo) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 4, background: '#fff',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.12)',
        }}>
          <img src={logo} alt={name || code} style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 2 }}
            onError={e => { e.currentTarget.style.display = 'none'; }} />
        </span>
        <span>{name || code}</span>
      </span>
    );
  }
  return <span>{name || code || '—'}</span>;
}

// ─── Status config ────────────────────────────────────────────
const STATUS = {
  booked:              { label: 'Booked',                      color: '#00BCD4', bg: 'rgba(0,188,212,0.12)',    icon: Package },
  collected:           { label: 'Collected',                   color: '#2196F3', bg: 'rgba(33,150,243,0.12)',   icon: Package },
  at_depot:            { label: 'At Hub',                      color: '#5C6BC0', bg: 'rgba(92,107,192,0.12)',   icon: Package },
  in_transit:          { label: 'In Transit',                  color: '#7B2FBE', bg: 'rgba(123,47,190,0.12)',   icon: Truck },
  out_for_delivery:    { label: 'Out for Delivery',            color: '#D97706', bg: 'rgba(255,193,7,0.12)',    icon: Truck },
  failed_delivery:     { label: 'Failed Attempt',              color: '#F44336', bg: 'rgba(244,67,54,0.12)',    icon: AlertTriangle },
  delivered:           { label: 'Delivered',                   color: '#00C853', bg: 'rgba(0,200,83,0.12)',     icon: PackageCheck },
  on_hold:             { label: 'On Hold',                     color: '#FF9800', bg: 'rgba(255,152,0,0.12)',    icon: Clock },
  exception:           { label: 'Address Issue',               color: '#F44336', bg: 'rgba(244,67,54,0.12)',    icon: AlertTriangle },
  returned:            { label: 'Return to Sender',            color: '#607D8B', bg: 'rgba(96,125,139,0.12)',   icon: RotateCcw },
  tracking_expired:    { label: 'Tracking Expired',            color: '#757575', bg: 'rgba(117,117,117,0.12)',  icon: Clock },
  cancelled:           { label: 'Cancelled',                   color: '#757575', bg: 'rgba(117,117,117,0.12)',  icon: AlertTriangle },
  awaiting_collection: { label: 'Awaiting Customer Collection',color: '#FF6F00', bg: 'rgba(255,111,0,0.12)',    icon: Store },
  damaged:             { label: 'Damaged',                     color: '#E91E8C', bg: 'rgba(233,30,140,0.12)',   icon: PackageX },
  customs_hold:        { label: 'Customs Hold',                color: '#9C27B0', bg: 'rgba(156,39,176,0.12)',   icon: ShieldAlert },
  unknown:             { label: 'Unknown',                     color: '#555555', bg: 'rgba(0,0,0,0.04)',  icon: Package },
};

function StatusBadge({ status, label, size = 'sm' }) {
  const cfg = STATUS[status] || STATUS.unknown;
  const Icon = cfg.icon;
  const isLg = size === 'lg';
  // Use the label passed in (from Dispatch Cloud's own status description) if provided,
  // otherwise fall back to our internal display label.
  const displayLabel = label || cfg.label;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: isLg ? 7 : 5,
      padding: isLg ? '5px 12px' : '3px 9px',
      borderRadius: 9999,
      background: cfg.bg,
      border: `1px solid ${cfg.color}44`,
      color: cfg.color,
      fontSize: isLg ? 13 : 11,
      fontWeight: 700,
      whiteSpace: 'nowrap',
    }}>
      <Icon size={isLg ? 13 : 10} strokeWidth={2.5} />
      {displayLabel}
    </span>
  );
}

// ─── Relative time ────────────────────────────────────────────
function timeAgo(ts) {
  if (!ts) return '—';
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 2)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// Precise elapsed duration, e.g. "3d 4h", "5h 12m", "8m".
function durationSince(ts) {
  if (!ts) return '—';
  const diff = Math.max(0, Date.now() - new Date(ts).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'less than a minute';
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${mm}m`;
  return `${mm}m`;
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ─── Stat card ────────────────────────────────────────────────
function KpiCard({ label, value, color, icon: Icon, active, onClick }) {
  const hasValue = (value || 0) > 0;
  return (
    <button
      onClick={onClick}
      style={{
        padding: '16px 18px',
        background: active
          ? `linear-gradient(135deg, ${color}30 0%, ${color}14 100%)`
          : hasValue
            ? `linear-gradient(135deg, ${color}18 0%, ${color}08 100%)`
            : 'rgba(0,0,0,0.02)',
        border: `2px solid ${active ? color + 'AA' : hasValue ? color + '44' : color + '1A'}`,
        borderRadius: 12,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 0.2s',
        boxShadow: active
          ? `0 0 24px ${color}44, inset 0 0 20px ${color}10`
          : hasValue ? `0 0 12px ${color}22` : 'none',
        position: 'relative',
        overflow: 'hidden',
        width: '100%',
      }}
    >
      {/* Background glow orb */}
      <div style={{
        position: 'absolute', right: -10, top: -10,
        width: 80, height: 80, borderRadius: '50%',
        background: `radial-gradient(circle, ${color}${hasValue ? '22' : '0A'} 0%, transparent 70%)`,
        pointerEvents: 'none',
      }} />

      {/* Icon box */}
      <div style={{
        width: 40, height: 40, borderRadius: 10,
        background: `${color}22`,
        border: `1.5px solid ${color}${hasValue ? '55' : '22'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 12,
        boxShadow: hasValue ? `0 0 12px ${color}33` : 'none',
      }}>
        <Icon size={20} color={color} strokeWidth={2.2} />
      </div>

      {/* Number */}
      <div style={{
        fontSize: 30, fontWeight: 900, lineHeight: 1, marginBottom: 5,
        color: hasValue ? color : '#333',
        textShadow: hasValue && active ? `0 0 16px ${color}88` : 'none',
      }}>
        {(value || 0).toLocaleString()}
      </div>

      {/* Label */}
      <div style={{
        fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: hasValue ? color + 'CC' : '#333',
        lineHeight: 1.3,
      }}>
        {label}
      </div>
    </button>
  );
}

// Keep these aliases so nothing else breaks
const StatCard     = KpiCard;
const BoldStatCard = KpiCard;

// ─── Event timeline ───────────────────────────────────────────
// Events arrive newest-first from the API (ORDER BY event_at DESC).
// The vertical line runs downward from each dot to the next older event.
function EventTimeline({ events }) {
  if (!events?.length) return <p style={{ color: '#64748B', fontSize: 13, fontStyle: 'italic' }}>No events yet</p>;
  return (
    <div style={{ position: 'relative' }}>
      {events.map((ev, i) => {
        const cfg = STATUS[ev.status] || STATUS.unknown;
        const isLast = i === events.length - 1;
        return (
          <div key={ev.id} style={{ display: 'flex', gap: 16, position: 'relative',
            paddingBottom: isLast ? 0 : 20 }}>
            {/* Dot + line downward to older event */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: cfg.bg,
                border: `2px solid ${cfg.color}`, display: 'flex', alignItems: 'center',
                justifyContent: 'center', zIndex: 1, flexShrink: 0 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: cfg.color }} />
              </div>
              {/* Line going down to next (older) event */}
              {!isLast && (
                <div style={{ width: 2, flex: 1, minHeight: 16,
                  background: 'linear-gradient(to bottom, rgba(0,0,0,0.10), rgba(0,0,0,0.03))' }} />
              )}
            </div>
            <div style={{ flex: 1, paddingTop: 2, paddingBottom: isLast ? 0 : 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
                <StatusBadge status={ev.status} />
                <span style={{ fontSize: 11, color: '#64748B' }}>{timeAgo(ev.event_at)}</span>
              </div>
              {ev.description && <p style={{ fontSize: 13, color: '#334155', margin: '3px 0' }}>{ev.description}</p>}
              {ev.location && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#64748B' }}>
                  <MapPin size={11} /> {ev.location}
                </span>
              )}
              <div style={{ fontSize: 11, color: '#475569', marginTop: 3 }}>
                {new Date(ev.event_at).toLocaleString('en-GB')}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Claims window logic ──────────────────────────────────────
const CLAIM_RULES = {
  dpd:             { windowDays: 14, windowFrom: 'first scan',   action: 'email',  actionLabel: 'Email DPD Platinum',  actionTo: 'platinum@dpd.co.uk',              note: 'Email DPD Platinum support to kick off the investigation. DPD will invite you to raise a formal claim once the investigation closes.' },
  dpd_local:       { windowDays: 14, windowFrom: 'first scan',   action: 'email',  actionLabel: 'Email DPD Platinum',  actionTo: 'platinum@dpd.co.uk',              note: 'Email DPD Platinum support to kick off the investigation. DPD will invite you to raise a formal claim once the investigation closes.' },
  dpdlocal:        { windowDays: 14, windowFrom: 'first scan',   action: 'email',  actionLabel: 'Email DPD Platinum',  actionTo: 'platinum@dpd.co.uk',              note: 'Email DPD Platinum support to kick off the investigation. DPD will invite you to raise a formal claim once the investigation closes.' },
  dhlparcelukcloud:{ windowDays: 14, windowFrom: 'expected delivery',action: 'email', actionLabel: 'Email DHL Support',   actionTo: 'parcel.uk@dhl.com',               note: 'Email DHL support to open an investigation. DHL should invite you to raise a formal claim within 21 days of the delivery date.' },
  dhl:             { windowDays: 14, windowFrom: 'expected delivery',action: 'email', actionLabel: 'Email DHL Support',   actionTo: 'parcel.uk@dhl.com',               note: 'Email DHL support to open an investigation. DHL should invite you to raise a formal claim within 21 days of the delivery date.' },
  yodel:           { windowDays: 7,  windowFrom: 'label generation', action: 'portal', actionLabel: 'Raise on AGL Portal', actionUrl: 'https://agl.yodel.co.uk',        note: 'Yodel claims must be raised via the AGL portal within 7 days of label generation (portal may accept up to 10 days). Act immediately.' },
  agl:             { windowDays: 7,  windowFrom: 'label generation', action: 'portal', actionLabel: 'Raise on AGL Portal', actionUrl: 'https://agl.yodel.co.uk',        note: 'Yodel claims must be raised via the AGL portal within 7 days of label generation (portal may accept up to 10 days). Act immediately.' },
  ups:             { windowDays: 14, windowFrom: 'first scan',   action: 'email',  actionLabel: 'Email UPS Claims',    actionTo: 'ukparcelclaims@ups.com',           note: 'Submit a UPS claim by email within 14 days of the parcel entering the network. Include shipment details and supporting evidence.' },
};

function getClaimInfo(parcel, consignmentNumber) {
  if (!parcel) return null;
  const code = (parcel.courier_code || '').toLowerCase();
  // Yodel parcels have JJD-prefix tracking numbers
  const isYodel = (consignmentNumber || '').toUpperCase().startsWith('JJD') || code === 'yodel' || code === 'agl';
  const rule = isYodel ? CLAIM_RULES.yodel : CLAIM_RULES[code];
  if (!rule) return null;

  // Reference date the window counts from:
  //   DHL                 → estimated/actual delivery (carrier rule)
  //   'first scan' rules  → the parcel's first physical network scan (NOT our
  //                         ingest time, which was the previous bug)
  //   otherwise           → label generation (created_at)
  const refDate = (code.startsWith('dhl') && (parcel.delivered_at || parcel.estimated_delivery))
    ? (parcel.delivered_at || parcel.estimated_delivery)
    : rule.windowFrom === 'first scan'
      ? (parcel.first_scan_at || parcel.created_at)
      : parcel.created_at;
  if (!refDate) return null;

  const deadline     = new Date(new Date(refDate).getTime() + rule.windowDays * 86400000);
  const msRemaining  = deadline.getTime() - Date.now();
  const daysRemaining = Math.ceil(msRemaining / 86400000);
  const expired       = daysRemaining < 0;
  const urgent        = !expired && daysRemaining <= 2;
  const warning       = !expired && !urgent && daysRemaining <= 5;

  return { ...rule, deadline, daysRemaining, expired, urgent, warning, refDate };
}

function ClaimsTab({ data, consignment }) {
  const info = getClaimInfo(data, consignment);
  const borderCol = '#1E293B';

  if (!info) {
    return (
      <div style={{ padding: '32px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>📦</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#334155', marginBottom: 6 }}>No claims window data</div>
        <div style={{ fontSize: 13, color: '#64748B', lineHeight: 1.6 }}>
          Claims window rules are not configured for this carrier.<br />Check directly with {data?.courier_name || 'the carrier'}.
        </div>
      </div>
    );
  }

  // Status band colours
  const statusColor = info.expired  ? '#EF4444'
                    : info.urgent   ? '#F97316'
                    : info.warning  ? '#D97706'
                    : '#00C853';
  const statusBg    = info.expired  ? 'rgba(239,68,68,0.12)'
                    : info.urgent   ? 'rgba(249,115,22,0.12)'
                    : info.warning  ? 'rgba(217,119,6,0.12)'
                    : 'rgba(0,200,83,0.10)';
  const statusLabel = info.expired
    ? `Window closed ${Math.abs(info.daysRemaining)} day${Math.abs(info.daysRemaining) !== 1 ? 's' : ''} ago`
    : info.urgent
    ? `⚠ URGENT — ${info.daysRemaining} day${info.daysRemaining !== 1 ? 's' : ''} remaining`
    : info.warning
    ? `${info.daysRemaining} days remaining — act soon`
    : `${info.daysRemaining} days remaining`;

  // Build mailto / portal URL
  const consignmentRef = consignment || '';
  const courierName    = data?.courier_name || '';
  const customerName   = data?.customer_name || data?.customer_account || '';
  let actionUrl;
  if (info.action === 'portal') {
    actionUrl = info.actionUrl;
  } else {
    const subject = encodeURIComponent(`Claims enquiry — ${courierName} — ${consignmentRef}`);
    const body = encodeURIComponent(
      `Dear ${courierName} Claims Team,\n\n` +
      `I am writing regarding consignment ${consignmentRef}.\n` +
      `Customer: ${customerName}\n` +
      `Carrier: ${courierName}\n\n` +
      `[Please describe the issue and attach supporting evidence here]\n\n` +
      `Kind regards,\nMoov Parcel`
    );
    actionUrl = `mailto:${info.actionTo}?subject=${subject}&body=${body}`;
  }

  return (
    <div style={{ width: '100%', maxWidth: 'none' }}>

      {/* Status banner */}
      <div style={{
        background: statusBg,
        border: `1px solid ${statusColor}55`,
        borderRadius: 10,
        padding: '14px 16px',
        marginBottom: 20,
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <div style={{ fontSize: 28, lineHeight: 1 }}>
          {info.expired ? '🔴' : info.urgent ? '🟠' : info.warning ? '🟡' : '🟢'}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: statusColor, marginBottom: 2 }}>
            {statusLabel}
          </div>
          <div style={{ fontSize: 12, color: '#64748B' }}>
            Deadline: {info.deadline.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
        </div>
      </div>

      {/* Window rules */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
          Claims Window Rules
        </div>
        {[
          ['Carrier',       data?.courier_name || '—'],
          ['Window',        `${info.windowDays} days from ${info.windowFrom}`],
          ['Reference date',new Date(info.refDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })],
          ['Deadline',      info.deadline.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })],
        ].map(([label, value]) => (
          <div key={label} style={{ display: 'flex', padding: '7px 0', borderBottom: `1px solid ${borderCol}` }}>
            <span style={{ fontSize: 12, color: '#64748B', width: 120, flexShrink: 0 }}>{label}</span>
            <span style={{ fontSize: 13, color: '#0F172A', fontWeight: 500 }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Process note */}
      <div style={{
        background: 'rgba(30,64,175,0.07)',
        border: '1px solid rgba(30,64,175,0.18)',
        borderRadius: 8,
        padding: '12px 14px',
        marginBottom: 20,
        fontSize: 13,
        color: '#1E293B',
        lineHeight: 1.6,
      }}>
        {info.note}
      </div>

      {/* Action button */}
      {!info.expired && (
        <a
          href={actionUrl}
          target={info.action === 'portal' ? '_blank' : '_self'}
          rel="noopener noreferrer"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            width: '100%', padding: '12px 20px',
            background: statusColor,
            color: '#FFFFFF',
            borderRadius: 8,
            fontSize: 14, fontWeight: 700,
            textDecoration: 'none',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          {info.action === 'portal' ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              {info.actionLabel}
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
              </svg>
              {info.actionLabel}
            </>
          )}
        </a>
      )}
      {info.expired && (
        <div style={{
          padding: '12px 16px', borderRadius: 8,
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
          fontSize: 13, color: '#991B1B', textAlign: 'center', lineHeight: 1.5,
        }}>
          The standard claims window has closed. Contact {data?.courier_name || 'the carrier'} directly — some carriers may accept late claims in exceptional circumstances.
        </div>
      )}
    </div>
  );
}

// ─── Parcel drawer ────────────────────────────────────────────
function ParcelDrawer({ consignment, onClose }) {
  const [activeTab, setActiveTab] = useState('events');
  const { data, isLoading } = useQuery({
    queryKey: ['parcel', consignment],
    queryFn:  () => api.get(`/tracking/${encodeURIComponent(consignment)}`).then(r => r.data),
    enabled:  !!consignment,
  });

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Compute claim status for tab badge
  const claimInfo = data ? getClaimInfo(data, consignment) : null;
  const claimBadgeColor = claimInfo?.expired  ? '#EF4444'
                        : claimInfo?.urgent   ? '#F97316'
                        : claimInfo?.warning  ? '#D97706'
                        : claimInfo           ? '#00C853'
                        : null;

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 400 }} />

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 480, background: '#FFFFFF',
        borderLeft: '1px solid rgba(0,0,0,0.10)',
        zIndex: 401, display: 'flex', flexDirection: 'column',
        boxShadow: '-8px 0 40px rgba(0,0,0,0.12)',
      }}>
        {/* Drawer header */}
        <div style={{ padding: '18px 24px', borderBottom: '1px solid rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Consignment</div>
            {(() => {
              const stored = data?.tracking_url;
              const code = (data?.courier_code || '').toLowerCase();
              const post = encodeURIComponent((data?.recipient_postcode || '').trim());
              const isYodel = consignment.toUpperCase().startsWith('JJD') || code === 'yodel' || code === 'agl';
              const fallback =
                isYodel                                           ? `https://www.yodel.co.uk/tracking/${consignment}/${post}`
                : code === 'dpd' || code === 'dpd_local' || code === 'dpdlocal'
                                                                  ? `https://www.dpd.co.uk/apps/tracking/?reference=${consignment}`
                : code.startsWith('dhl')                         ? `https://track.dhlparcel.co.uk/?con=${consignment}`
                : code === 'evri' || code === 'hermes'           ? `https://www.evri.com/track-a-parcel/${consignment}`
                : code === 'royal_mail' || code === 'royalmail'  ? `https://www.royalmail.com/track-your-item#/tracking-results/${consignment}`
                : code === 'parcelforce'                         ? `https://www.parcelforce.com/track-trace?trackNumber=${consignment}`
                : code === 'ups'                                 ? `https://www.ups.com/track?loc=en_GB&tracknum=${consignment}`
                : code === 'fedex'                               ? `https://www.fedex.com/en-gb/tracking.html?tracknumbers=${consignment}`
                : null;
              const url = stored || fallback;
              return url ? (
                <a href={url} target="_blank" rel="noopener noreferrer" style={{
                  fontSize: 17, fontWeight: 900, color: '#0F172A', fontFamily: 'monospace',
                  textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 7,
                  borderBottom: '2px solid rgba(26,115,232,0.4)', paddingBottom: 1,
                }}>
                  {consignment}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1a73e8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                </a>
              ) : (
                <div style={{ fontSize: 17, fontWeight: 900, color: '#0F172A', fontFamily: 'monospace' }}>{consignment}</div>
              );
            })()}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: 4 }}><X size={18} /></button>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid rgba(0,0,0,0.08)', background: '#F8FAFC' }}>
          {[
            { key: 'events', label: `Events${data ? ` (${data.events?.length || 0})` : ''}` },
            { key: 'claims', label: 'Claims Window', badgeColor: claimBadgeColor },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                flex: 1, padding: '11px 14px',
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 700,
                color: activeTab === tab.key ? '#1E40AF' : '#64748B',
                borderBottom: activeTab === tab.key ? '2px solid #1E40AF' : '2px solid transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                transition: 'color 0.1s',
              }}
            >
              {tab.label}
              {tab.badgeColor && (
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: tab.badgeColor,
                  display: 'inline-block', flexShrink: 0,
                }} />
              )}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8' }}>Loading…</div>
        ) : data ? (
          <div style={{ flex: 1, overflowY: 'auto' }}>

            {activeTab === 'events' && (
              <div style={{ padding: '20px 24px' }}>
                {/* How long it's been sitting in its current status */}
                <div style={{ marginBottom: 20, padding: '12px 14px', background: '#F8FAFC', borderRadius: 10, border: '1px solid rgba(0,0,0,0.06)' }}>
                  <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>In this status</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: data.status === 'delivered' ? '#00C853' : '#0F172A', marginTop: 2 }}>{durationSince(data.last_event_at)}</div>
                </div>
                {/* Delivery address */}
                {(data.recipient_name || data.recipient_address || data.recipient_postcode) && (
                  <div style={{ marginBottom: 20, padding: 14, background: 'rgba(0,188,212,0.05)', borderRadius: 10, border: '1px solid rgba(0,188,212,0.2)' }}>
                    <div style={{ fontSize: 11, color: '#0891B2', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <MapPin size={11} /> Delivery Address
                    </div>
                    {data.recipient_name && <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>{data.recipient_name}</div>}
                    {data.recipient_address && <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.6, whiteSpace: 'pre-line' }}>{data.recipient_address}</div>}
                    {data.recipient_postcode && <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginTop: data.recipient_address ? 2 : 0 }}>{data.recipient_postcode}</div>}
                    {data.estimated_delivery && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 11, color: '#64748B' }}>Estimated delivery</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#D97706' }}>{fmtDate(data.estimated_delivery)}</span>
                      </div>
                    )}
                    {data.delivered_at && (
                      <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 11, color: '#64748B' }}>Delivered</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#00C853' }}>{new Date(data.delivered_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Event timeline */}
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>
                  Event History ({data.events?.length || 0})
                </div>
                <EventTimeline events={data.events} />

                {/* Parcel meta */}
                <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                  {[
                    ['Courier',   data.courier_name ? <CourierBadge name={data.courier_name} code={data.courier_code} /> : null],
                    ['Service',   data.service_name || null],
                    ['Customer',  data.customer_name || data.customer_account || null],
                    ['Account',   data.customer_account || null],
                    ['Weight',    data.weight_kg ? `${parseFloat(data.weight_kg).toFixed(2)} kg` : null],
                  ].filter(([, v]) => v).map(([label, value]) => (
                    <div key={label} style={{ display: 'flex', padding: '7px 0', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                      <span style={{ fontSize: 12, color: '#94A3B8', width: 120, flexShrink: 0 }}>{label}</span>
                      <span style={{ fontSize: 13, color: '#0F172A', fontWeight: 500 }}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'claims' && (
              <ClaimsTab data={data} consignment={consignment} />
            )}

          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8' }}>Not found</div>
        )}
      </div>
    </>
  );
}

// ─── Date range helpers ───────────────────────────────────────
const isoDay = d => format(d, 'yyyy-MM-dd');
const TODAY  = new Date();

const DATE_PRESETS = [
  { label: 'Today',        get: () => ({ from: isoDay(startOfDay(TODAY)), to: isoDay(endOfDay(TODAY)) }) },
  { label: 'Last 7 days',  get: () => ({ from: isoDay(subDays(TODAY, 7)),  to: isoDay(endOfDay(TODAY)) }) },
  { label: 'Last 30 days', get: () => ({ from: isoDay(subDays(TODAY, 30)), to: isoDay(endOfDay(TODAY)) }) },
  { label: 'Month to date',get: () => ({ from: isoDay(startOfMonth(TODAY)),to: isoDay(endOfDay(TODAY)) }) },
  { label: 'Custom',       get: null },
];

// ─── Shared dark select style ─────────────────────────────────
const darkSelect = {
  background: '#FFFFFF',
  border: '1px solid rgba(0,0,0,0.10)',
  borderRadius: 8,
  color: '#0F172A',
  fontSize: 13,
  padding: '8px 12px',
  outline: 'none',
  cursor: 'pointer',
  height: 38,
  appearance: 'none',
  WebkitAppearance: 'none',
  paddingRight: 28,
};

// ─── Main tracking page ───────────────────────────────────────

export default function TrackingPage() {
  const [searchParams] = useSearchParams();
  const [search,          setSearch]        = useState(searchParams.get('q') || '');
  const [debouncedSearch, setDebounced]     = useState(searchParams.get('q') || '');
  const [statusFilter,    setStatusFilter]  = useState('');
  const [courierFilter,   setCourierFilter] = useState('');
  const [customerFilter,  setCustomerFilter]= useState('');
  const [datePreset,      setDatePreset]    = useState('');   // label of active preset, '' = all time
  const [dateFrom,        setDateFrom]      = useState('');
  const [dateTo,          setDateTo]        = useState('');
  const [showCustomDate,  setShowCustomDate]= useState(false);
  const [page,            setPage]          = useState(0);
  const [selected,        setSelected]      = useState(null);
  const [staleRunning,    setStaleRunning]  = useState(false);
  const [staleResult,     setStaleResult]   = useState(null);
  const [stuckOpen,       setStuckOpen]     = useState(false);
  const searchRef = useRef(null);
  const LIMIT = 50;

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [debouncedSearch, statusFilter, courierFilter, customerFilter, dateFrom, dateTo]);

  function applyPreset(preset) {
    if (!preset.get) {
      setDatePreset('Custom');
      setShowCustomDate(true);
      return;
    }
    const { from, to } = preset.get();
    setDatePreset(preset.label);
    setDateFrom(from);
    setDateTo(to);
    setShowCustomDate(false);
  }

  function clearDateRange() {
    setDatePreset('');
    setDateFrom('');
    setDateTo('');
    setShowCustomDate(false);
  }

  const { data: stats, refetch: refetchStats } = useQuery({
    queryKey: ['tracking-stats'],
    queryFn:  () => api.get('/tracking/stats').then(r => r.data),
    refetchInterval: 60000,
  });

  const { data: list, isLoading, refetch: refetchList } = useQuery({
    queryKey: ['tracking-list', debouncedSearch, statusFilter, courierFilter, customerFilter, dateFrom, dateTo, page],
    queryFn:  () => api.get('/tracking', { params: {
      search:       debouncedSearch  || undefined,
      status:       statusFilter     || undefined,
      courier_code: courierFilter    || undefined,
      customer_id:  customerFilter   || undefined,
      date_from:    dateFrom         || undefined,
      date_to:      dateTo           || undefined,
      limit:  LIMIT,
      offset: page * LIMIT,
    }}).then(r => r.data),
    refetchInterval: 60000,
  });

  // Booked but never moved — still 'booked' from before today (excl. Royal Mail).
  const { data: stuck } = useQuery({
    queryKey: ['tracking-stuck'],
    queryFn:  () => api.get('/tracking/stuck').then(r => r.data),
    refetchInterval: 120000,
  });

  function refresh() { refetchStats(); refetchList(); }

  async function refreshStale() {
    setStaleRunning(true);
    setStaleResult(null);
    try {
      const res = await api.post('/tracking/refresh-stale', { days: 7, limit: 500, delay_ms: 400 });
      setStaleResult({ ok: true, msg: `Found ${res.data.found} stale parcels — updating in background` });
    } catch (err) {
      setStaleResult({ ok: false, msg: err?.response?.data?.error || 'Request failed' });
    } finally {
      setStaleRunning(false);
    }
  }

  function clearAll() {
    setStatusFilter(''); setCourierFilter(''); setCustomerFilter(''); setSearch('');
    clearDateRange();
  }

  // Data-driven filter options from stats
  const customers    = stats?.by_customer || [];
  const couriers     = stats?.by_courier  || [];
  const activeStatuses = Object.entries(stats?.by_status || {})
    .filter(([, count]) => count > 0)
    .map(([status]) => status);

  const parcels = list?.parcels || [];
  const total   = list?.total   || 0;
  const pages   = Math.ceil(total / LIMIT);
  const bs = stats?.by_status || {};
  const hasFilters = statusFilter || courierFilter || customerFilter || search || dateFrom || dateTo;

  function toggleStatus(s) { setStatusFilter(f => f === s ? '' : s); }

  // "Delivered Today" is a special combined filter — status + today's date range.
  // Toggling it off must also clear the date range so it doesn't linger.
  function toggleDeliveredToday() {
    if (statusFilter === 'delivered') {
      setStatusFilter('');
      setDateFrom('');
      setDateTo('');
      setDatePreset('');
    } else {
      setStatusFilter('delivered');
      setDateFrom(isoDay(startOfDay(TODAY)));
      setDateTo(isoDay(endOfDay(TODAY)));
      setDatePreset('Today');
    }
  }

  return (
    <div style={{ padding: '24px 28px' }}>

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24, gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', margin: 0 }}>Tracking</h1>
          <p style={{ fontSize: 13, color: '#64748B', margin: '4px 0 0' }}>
            {stats ? `${(stats.total_active || 0).toLocaleString()} active parcels` : 'Loading…'}
          </p>
        </div>
        <button onClick={refresh} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: '1px solid rgba(0,0,0,0.10)', borderRadius: 7, color: '#64748B', fontSize: 12, padding: '7px 14px', cursor: 'pointer' }}>
          <RefreshCw size={13} /> Refresh
        </button>
        <button
          onClick={refreshStale}
          disabled={staleRunning}
          title="Re-fetch tracking for parcels with no update in 7+ days"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: staleRunning ? 'rgba(123,47,190,0.08)' : 'rgba(123,47,190,0.06)',
            border: '1px solid rgba(123,47,190,0.25)',
            borderRadius: 7, color: '#7B2FBE', fontSize: 12, fontWeight: 600,
            padding: '7px 14px', cursor: staleRunning ? 'not-allowed' : 'pointer',
            opacity: staleRunning ? 0.7 : 1,
          }}
        >
          <RotateCcw size={13} style={{ animation: staleRunning ? 'spin 1s linear infinite' : 'none' }} />
          {staleRunning ? 'Refreshing…' : 'Refresh Stale'}
        </button>
        {staleResult && (
          <span style={{
            fontSize: 12, padding: '5px 11px', borderRadius: 7,
            background: staleResult.ok ? 'rgba(0,200,83,0.08)' : 'rgba(244,67,54,0.08)',
            border: `1px solid ${staleResult.ok ? 'rgba(0,200,83,0.3)' : 'rgba(244,67,54,0.3)'}`,
            color: staleResult.ok ? '#00C853' : '#F44336',
          }}>
            {staleResult.msg}
          </span>
        )}
      </div>

      {/* ── Booked but never moved (excl. Royal Mail) ──────────── */}
      {stuck?.total > 0 && (
        <div style={{ marginBottom: 24, border: '1px solid rgba(244,67,54,0.3)', borderRadius: 10, background: 'rgba(244,67,54,0.05)', overflow: 'hidden' }}>
          <button onClick={() => setStuckOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
            <AlertTriangle size={20} color="#F44336" />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: '#0F172A' }}>{stuck.total} parcel{stuck.total !== 1 ? 's' : ''} booked but never moved</div>
              <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>Still awaiting a first carrier scan from before today{stuck.excludes_royal_mail ? ' · Royal Mail excluded (no collection scan)' : ''}</div>
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#F44336' }}>{stuckOpen ? 'Hide ▲' : 'View ▼'}</span>
          </button>
          {stuckOpen && (
            <div style={{ maxHeight: 360, overflowY: 'auto', borderTop: '1px solid rgba(244,67,54,0.2)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead><tr style={{ color: '#94A3B8', textAlign: 'left', fontSize: 11, position: 'sticky', top: 0, background: '#FDECEA' }}>
                  <th style={{ padding: '7px 12px' }}>Consignment</th><th style={{ padding: '7px 6px' }}>Customer</th>
                  <th style={{ padding: '7px 6px' }}>Carrier</th><th style={{ padding: '7px 6px' }}>Postcode</th>
                  <th style={{ padding: '7px 12px', textAlign: 'right' }}>Days stuck</th>
                </tr></thead>
                <tbody>
                  {stuck.rows.map((s, i) => (
                    <tr key={i} onClick={() => setSelected(s.consignment_number)} style={{ cursor: 'pointer', borderTop: '1px solid rgba(0,0,0,0.05)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(244,67,54,0.06)'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#00BCD4' }}>{s.consignment_number}</td>
                      <td style={{ padding: '8px 6px', color: '#0F172A' }}>{s.customer_name || '—'}</td>
                      <td style={{ padding: '8px 6px', color: '#334155' }}>{s.courier_name || '—'}</td>
                      <td style={{ padding: '8px 6px', color: '#64748B' }}>{s.recipient_postcode || '—'}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: s.days_stuck >= 3 ? '#F44336' : '#D97706' }}>{s.days_stuck}d</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── KPI cards ──────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 24 }}>
        <KpiCard label="In Transit"                  value={bs.in_transit}           color="#FF9800" icon={Truck}         active={statusFilter==='in_transit'}          onClick={() => toggleStatus('in_transit')} />
        <KpiCard label="At Hub"                      value={bs.at_depot}             color="#1976D2" icon={Warehouse}     active={statusFilter==='at_depot'}            onClick={() => toggleStatus('at_depot')} />
        <KpiCard label="Out for Delivery"            value={bs.out_for_delivery}     color="#D97706" icon={Navigation}    active={statusFilter==='out_for_delivery'}    onClick={() => toggleStatus('out_for_delivery')} />
        <KpiCard label="On Hold"                     value={bs.on_hold}              color="#F44336" icon={OctagonX}      active={statusFilter==='on_hold'}             onClick={() => toggleStatus('on_hold')} />
        <KpiCard label="Awaiting Collection"         value={bs.awaiting_collection}  color="#FF9800" icon={Store}         active={statusFilter==='awaiting_collection'} onClick={() => toggleStatus('awaiting_collection')} />
        <KpiCard label="Delivered Today"             value={stats?.delivered_today}  color="#00C853" icon={PackageCheck}  active={statusFilter==='delivered'}           onClick={toggleDeliveredToday} />
        <KpiCard label="Address Issue"               value={(bs.exception||0)}       color="#F44336" icon={AlertTriangle} active={statusFilter==='exception'}           onClick={() => toggleStatus('exception')} />
        <KpiCard label="Failed Attempt"              value={(bs.failed_delivery||0)} color="#F44336" icon={AlertTriangle} active={statusFilter==='failed_delivery'}     onClick={() => toggleStatus('failed_delivery')} />
        <KpiCard label="Customs Hold"                value={bs.customs_hold}         color="#9C27B0" icon={Plane}         active={statusFilter==='customs_hold'}        onClick={() => toggleStatus('customs_hold')} />
        <KpiCard label="Return to Sender"            value={bs.returned}             color="#F44336" icon={RotateCcw}     active={statusFilter==='returned'}            onClick={() => toggleStatus('returned')} />
        <KpiCard label="Damaged"                     value={(bs.damaged||0)}         color="#9C27B0" icon={PackageX}      active={statusFilter==='damaged'}             onClick={() => toggleStatus('damaged')} />
      </div>

      {/* ── Date range ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Calendar size={14} color="#64748B" />
        {DATE_PRESETS.map(p => (
          <button key={p.label} onClick={() => applyPreset(p)} style={{
            padding: '6px 13px', borderRadius: 20, fontSize: 12, fontWeight: 600,
            border: '1px solid',
            borderColor: datePreset === p.label ? '#00C853' : 'rgba(0,0,0,0.08)',
            background: datePreset === p.label ? 'rgba(0,200,83,0.12)' : 'transparent',
            color: datePreset === p.label ? '#00C853' : '#64748B',
            cursor: 'pointer',
          }}>
            {p.label}
          </button>
        ))}
        {datePreset && (
          <button onClick={clearDateRange} style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', fontSize: 12, padding: '0 4px' }}>
            <X size={12} />
          </button>
        )}
        {/* Custom date inputs */}
        {showCustomDate && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              style={{ ...darkSelect, width: 140 }} />
            <span style={{ color: '#475569', fontSize: 12 }}>–</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              style={{ ...darkSelect, width: 140 }} />
          </div>
        )}
      </div>

      {/* ── Filters row ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Search */}
        <div style={{ position: 'relative', flex: 1, minWidth: 240, maxWidth: 380 }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#64748B', pointerEvents: 'none' }} />
          <input
            ref={searchRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Consignment, postcode, recipient…"
            style={{ width: '100%', boxSizing: 'border-box', background: '#FFFFFF', border: '1px solid rgba(0,0,0,0.10)', borderRadius: 8, padding: '9px 36px', color: '#0F172A', fontSize: 13, outline: 'none' }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', padding: 0, display: 'flex' }}>
              <X size={14} />
            </button>
          )}
        </div>

        {/* Customer — only shows customers who have parcels */}
        {customers.length > 0 && (
          <div style={{ position: 'relative' }}>
            <select value={customerFilter} onChange={e => setCustomerFilter(e.target.value)} style={{ ...darkSelect, minWidth: 170 }}>
              <option value="">All customers</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748B', pointerEvents: 'none', fontSize: 10 }}>▾</span>
          </div>
        )}

        {/* Status — only shows statuses that exist in the table */}
        <div style={{ position: 'relative' }}>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...darkSelect, minWidth: 160 }}>
            <option value="">All statuses</option>
            {activeStatuses.map(s => (
              <option key={s} value={s}>{STATUS[s]?.label || s}</option>
            ))}
          </select>
          <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748B', pointerEvents: 'none', fontSize: 10 }}>▾</span>
        </div>

        {/* Courier — only shows couriers that exist in the table */}
        {couriers.length > 0 && (
          <div style={{ position: 'relative' }}>
            <select value={courierFilter} onChange={e => setCourierFilter(e.target.value)} style={{ ...darkSelect, minWidth: 155 }}>
              <option value="">All couriers</option>
              {couriers.map(c => (
                <option key={c.courier_code || c.courier_name} value={c.courier_code || c.courier_name}>
                  {c.courier_name} ({c.count})
                </option>
              ))}
            </select>
            <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748B', pointerEvents: 'none', fontSize: 10 }}>▾</span>
          </div>
        )}

        {/* Clear all */}
        {hasFilters && (
          <button onClick={clearAll} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(233,30,140,0.1)', border: '1px solid rgba(233,30,140,0.3)', borderRadius: 7, color: '#E91E8C', fontSize: 12, fontWeight: 700, padding: '7px 14px', cursor: 'pointer' }}>
            <X size={12} /> Clear
          </button>
        )}

        <span style={{ fontSize: 12, color: '#64748B', marginLeft: 'auto' }}>
          {total.toLocaleString()} parcel{total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Parcel table ─────────────────────────────────────────── */}
      <div className="moov-card" style={{ overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#64748B' }}>Loading…</div>
        ) : parcels.length === 0 ? (
          <div style={{ padding: 64, textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📦</div>
            <div style={{ fontSize: 16, color: '#64748B', fontWeight: 600 }}>
              {debouncedSearch || statusFilter || courierFilter ? 'No parcels match your filters' : 'No tracking data yet'}
            </div>
            {!debouncedSearch && !statusFilter && (
              <div style={{ fontSize: 13, color: '#475569', marginTop: 8 }}>
                Tracking events will appear here as webhooks arrive
              </div>
            )}
          </div>
        ) : (
          <table className="moov-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ width: 160 }}>Consignment</th>
                <th>Customer</th>
                <th>Courier</th>
                <th>Recipient</th>
                <th>Status</th>
                <th>Last Event</th>
                <th style={{ width: 90, textAlign: 'center' }}>Est. Del.</th>
                <th style={{ width: 32 }}></th>
              </tr>
            </thead>
            <tbody>
              {parcels.map(p => (
                <tr
                  key={p.id}
                  onClick={() => setSelected(p.consignment_number)}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.03)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <td>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#00BCD4', fontSize: 12 }}>
                      {p.consignment_number}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontSize: 13, color: '#0F172A', fontWeight: 500 }}>{p.customer_name || '—'}</div>
                    {p.customer_account && <div style={{ fontSize: 11, color: '#64748B' }}>{p.customer_account}</div>}
                  </td>
                  <td>
                    <div style={{ fontSize: 13, color: '#334155' }}>
                      <CourierBadge name={p.courier_name} code={p.courier_code} />
                    </div>
                    {p.service_name && <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>{p.service_name}</div>}
                  </td>
                  <td>
                    <div style={{ fontSize: 13, color: '#334155' }}>{p.recipient_name || '—'}</div>
                    {p.recipient_postcode && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: '#64748B' }}>
                        <MapPin size={10} /> {p.recipient_postcode}
                      </span>
                    )}
                  </td>
                  <td><StatusBadge status={p.status} /></td>
                  <td>
                    <div style={{ fontSize: 12, color: '#334155' }}>{p.status_description?.slice(0, 40) || p.last_location || '—'}</div>
                    <div style={{ fontSize: 11, color: '#64748B' }}>{timeAgo(p.last_event_at)}</div>
                  </td>
                  <td style={{ textAlign: 'center', fontSize: 12, color: '#64748B' }}>
                    {p.status === 'delivered'
                      ? <span style={{ color: '#00C853', fontWeight: 700 }}>✓ Done</span>
                      : fmtDate(p.estimated_delivery)}
                  </td>
                  <td><ChevronRight size={14} color="#333" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ───────────────────────────────────────────── */}
      {pages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16 }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            className="btn-ghost" style={{ height: 32, padding: '0 14px', fontSize: 12 }}>← Prev</button>
          <span style={{ fontSize: 13, color: '#64748B' }}>Page {page + 1} of {pages}</span>
          <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}
            className="btn-ghost" style={{ height: 32, padding: '0 14px', fontSize: 12 }}>Next →</button>
        </div>
      )}

      {/* ── Parcel detail drawer ─────────────────────────────────── */}
      {selected && <ParcelDrawer consignment={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
