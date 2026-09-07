import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock, RefreshCw, AlertTriangle, CheckCircle2,
  Package, Truck, Clock, MapPin, Building2, Phone, Mail,
  X, AlertCircle, Sparkles, ChevronRight
} from 'lucide-react';
import { listCollections, createCollection, cancelCollection, rescheduleCollection } from '../../api/collections';

const COUNTRIES = [
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'IT', name: 'Italy' },
  { code: 'ES', name: 'Spain' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'IE', name: 'Ireland' },
  { code: 'BE', name: 'Belgium' },
  { code: 'AU', name: 'Australia' },
  { code: 'CA', name: 'Canada' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'AT', name: 'Austria' },
  { code: 'PL', name: 'Poland' },
  { code: 'SE', name: 'Sweden' },
  { code: 'NO', name: 'Norway' },
  { code: 'DK', name: 'Denmark' },
  { code: 'JP', name: 'Japan' },
  { code: 'CN', name: 'China' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'SG', name: 'Singapore' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'SA', name: 'Saudi Arabia' },
];

const SERVICES = [
  { code: '011', name: 'UPS Standard (011)' },
  { code: '065', name: 'UPS Express Saver (065)' },
  { code: '007', name: 'UPS Express (007)' },
  { code: '008', name: 'UPS Expedited (008)' },
  { code: '001', name: 'UPS Next Day Air (001)' },
];

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

export default function CollectionsPage() {
  const queryClient = useQueryClient();

  // Form State — Cloud9 Fulfillment Defaults
  const [trackingNumber, setTrackingNumber] = useState('');
  const [serviceCode, setServiceCode] = useState('011');
  const [companyName, setCompanyName] = useState('Cloud9 Fulfillment');
  const [contactName, setContactName] = useState('Joshua Hegarty');
  const [addressLine1, setAddressLine1] = useState('Units 3-5 Kettlebridge Road');
  const [addressLine2, setAddressLine2] = useState('Parkway Link');
  const [city, setCity] = useState('Sheffield');
  const [postcode, setPostcode] = useState('S9 3AJ');
  const [country, setCountry] = useState('GB');
  const [destCountry, setDestCountry] = useState('GB');
  const [phone, setPhone] = useState('0114 551 138');
  const [email, setEmail] = useState('service@cloud9fulfillment.co.uk');
  const [residential, setResidential] = useState(false);
  const [pickupDate, setPickupDate] = useState(todayString());
  const [readyTime, setReadyTime] = useState('09:00');
  const [closeTime, setCloseTime] = useState('17:00');
  const [parcels, setParcels] = useState(1);
  const [weight, setWeight] = useState(5.0);
  const [specialInstruction, setSpecialInstruction] = useState('');

  // Status & Feedback banners
  const [successResult, setSuccessResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  // Reschedule modal state
  const [rescheduleModal, setRescheduleModal] = useState(null);
  const [reschedDate, setReschedDate] = useState(todayString());
  const [reschedReady, setReschedReady] = useState('09:00');
  const [reschedClose, setReschedClose] = useState('17:00');
  const [reschedInstructions, setReschedInstructions] = useState('');

  // Query collections list
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['collections-list'],
    queryFn: () => listCollections({ limit: 50 }),
  });
  const collections = (data?.collections || []).filter(c => c.status !== 'failed' && c.prn);

  // Book collection mutation
  const [errorDetails, setErrorDetails] = useState(null);
  const bookMutation = useMutation({
    mutationFn: createCollection,
    onSuccess: (res) => {
      setErrorMessage(null);
      setErrorDetails(null);
      setSuccessResult(res);
      queryClient.invalidateQueries({ queryKey: ['collections-list'] });
    },
    onError: (err) => {
      setSuccessResult(null);
      const data = err.response?.data;
      const msg = data?.error || err.message || 'Failed to book collection with UPS';
      setErrorMessage(msg);
      setErrorDetails({
        status: data?.status || err.response?.status,
        raw: data?.raw,
        request: data?.request,
      });
    },
  });

  // Cancel collection mutation
  const cancelMutation = useMutation({
    mutationFn: cancelCollection,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections-list'] });
    },
    onError: (err) => {
      alert('Error cancelling collection: ' + (err.response?.data?.error || err.message));
    },
  });

  // Reschedule collection mutation
  const rescheduleMutation = useMutation({
    mutationFn: rescheduleCollection,
    onSuccess: (res) => {
      setRescheduleModal(null);
      alert('Collection rescheduled successfully with UPS!\n\nNew PRN: ' + (res.newPrn || res.oldPrn));
      queryClient.invalidateQueries({ queryKey: ['collections-list'] });
    },
    onError: (err) => {
      alert('Error rescheduling collection: ' + (err.response?.data?.error || err.message));
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessResult(null);

    if (!addressLine1.trim() || !city.trim() || !postcode.trim()) {
      setErrorMessage('Address Line 1, Town / City, and Postcode are required.');
      return;
    }
    if (!phone.trim()) {
      setErrorMessage('Phone number is required for courier collections.');
      return;
    }
    if (!pickupDate) {
      setErrorMessage('Pickup date is required.');
      return;
    }

    bookMutation.mutate({
      trackingNumber: trackingNumber.trim() || undefined,
      serviceCode,
      companyName: companyName.trim() || undefined,
      contactName: contactName.trim() || undefined,
      addressLine1: addressLine1.trim(),
      addressLine2: addressLine2.trim() || undefined,
      city: city.trim(),
      postalCode: postcode.trim(),
      country,
      destinationCountry: destCountry,
      phone: phone.trim(),
      email: email.trim() || undefined,
      residential,
      pickupDate,
      readyTime,
      closeTime,
      parcels: Number(parcels) || 1,
      weight: Number(weight) || 1.0,
      specialInstruction: specialInstruction.trim() || undefined,
    });
  };

  const handleCancel = (prn) => {
    if (!window.confirm(`Are you sure you want to cancel UPS collection PRN: ${prn}?`)) return;
    cancelMutation.mutate(prn);
  };

  const openReschedule = (col) => {
    setRescheduleModal(col);
    setReschedDate(col.pickup_date || todayString());
    setReschedReady(col.ready_time || '09:00');
    setReschedClose(col.close_time || '17:00');
    setReschedInstructions(col.special_instruction || '');
  };

  const handleRescheduleSubmit = (e) => {
    e.preventDefault();
    if (!rescheduleModal?.prn) return;
    rescheduleMutation.mutate({
      oldPrn: rescheduleModal.prn,
      pickupDate: reschedDate,
      readyTime: reschedReady,
      closeTime: reschedClose,
      instructions: reschedInstructions,
    });
  };

  return (
    <div style={{ width: '100%', maxWidth: 'none', paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: 'linear-gradient(135deg, #FF6F00, #7B2FBE)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff'
          }}>
            <CalendarClock size={22} />
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0F172A', margin: 0 }}>UPS Collection Booking</h1>
            <p style={{ fontSize: 13, color: '#64748B', margin: 0 }}>
              Schedule, track, and manage driver parcel pickups directly with UPS.
            </p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', borderRadius: 8, background: '#fff',
            border: '1px solid rgba(0,0,0,0.12)', fontSize: 13, fontWeight: 600,
            color: '#334155', cursor: 'pointer'
          }}
        >
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Main Booking Form Card */}
      <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 14, padding: 24, marginBottom: 28 }}>
        <form onSubmit={handleSubmit}>
          {/* Tracking Callout */}
          <div style={{
            background: 'rgba(123,47,190,0.05)', border: '1px solid rgba(123,47,190,0.2)',
            borderRadius: 10, padding: '14px 18px', marginBottom: 22,
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#7B2FBE', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Sparkles size={14} /> Quick Link With Existing Tracking Number
            </div>
            <p style={{ fontSize: 12.5, color: '#475569', margin: '0 0 12px 0' }}>
              If a UPS shipping label / tracking number has already been generated, enter it below to associate the pickup directly with the parcel.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
              <div>
                <label style={labelStyle}>UPS Tracking Number (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. 1Z9999999999999999"
                  value={trackingNumber}
                  onChange={e => setTrackingNumber(e.target.value)}
                  style={{ ...inputStyle, fontFamily: 'monospace', fontWeight: 600 }}
                />
              </div>
              <div>
                <label style={labelStyle}>Service Level</label>
                <select
                  value={serviceCode}
                  onChange={e => setServiceCode(e.target.value)}
                  style={inputStyle}
                >
                  {SERVICES.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Form 2-Column Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
            {/* Column 1: Pickup Location & Contact */}
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginBottom: 14, borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: 6 }}>
                Pickup Location & Contact
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={labelStyle}>Company Name</label>
                    <input
                      type="text"
                      placeholder="Company / Sender"
                      value={companyName}
                      onChange={e => setCompanyName(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Contact Name</label>
                    <input
                      type="text"
                      placeholder="Contact Person"
                      value={contactName}
                      onChange={e => setContactName(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                </div>

                <div>
                  <label style={labelStyle}>Address Line 1 *</label>
                  <input
                    type="text"
                    placeholder="Street address"
                    value={addressLine1}
                    onChange={e => setAddressLine1(e.target.value)}
                    style={inputStyle}
                    required
                  />
                </div>

                <div>
                  <label style={labelStyle}>Address Line 2 (Optional)</label>
                  <input
                    type="text"
                    placeholder="Unit, Building, Floor"
                    value={addressLine2}
                    onChange={e => setAddressLine2(e.target.value)}
                    style={inputStyle}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={labelStyle}>Town / City *</label>
                    <input
                      type="text"
                      placeholder="City"
                      value={city}
                      onChange={e => setCity(e.target.value)}
                      style={inputStyle}
                      required
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Postcode *</label>
                    <input
                      type="text"
                      placeholder="Postcode"
                      value={postcode}
                      onChange={e => setPostcode(e.target.value)}
                      style={inputStyle}
                      required
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={labelStyle}>Pickup Country</label>
                    <select
                      value={country}
                      onChange={e => setCountry(e.target.value)}
                      style={inputStyle}
                    >
                      {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Destination Country</label>
                    <select
                      value={destCountry}
                      onChange={e => setDestCountry(e.target.value)}
                      style={inputStyle}
                    >
                      {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={labelStyle}>Phone Number *</label>
                    <input
                      type="tel"
                      placeholder="e.g. 07123456789"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      style={inputStyle}
                      required
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Notification Email</label>
                    <input
                      type="email"
                      placeholder="alerts@domain.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                </div>

                <div style={{ marginTop: 4 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#334155', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={residential}
                      onChange={e => setResidential(e.target.checked)}
                      style={{ borderRadius: 4, width: 16, height: 16 }}
                    />
                    Residential Address
                  </label>
                </div>
              </div>
            </div>

            {/* Column 2: Schedule & Parcel Info */}
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginBottom: 14, borderBottom: '1px solid rgba(0,0,0,0.06)', paddingBottom: 6 }}>
                Schedule & Parcel Details
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={labelStyle}>Pickup Date *</label>
                  <input
                    type="date"
                    value={pickupDate}
                    onChange={e => setPickupDate(e.target.value)}
                    style={inputStyle}
                    required
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={labelStyle}>Ready Time</label>
                    <input
                      type="time"
                      value={readyTime}
                      onChange={e => setReadyTime(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Latest Close Time</label>
                    <input
                      type="time"
                      value={closeTime}
                      onChange={e => setCloseTime(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={labelStyle}>Parcels Count</label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={parcels}
                      onChange={e => setParcels(e.target.value)}
                      style={inputStyle}
                      required
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Total Weight (kg)</label>
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={weight}
                      onChange={e => setWeight(e.target.value)}
                      style={inputStyle}
                      required
                    />
                  </div>
                </div>

                <div>
                  <label style={labelStyle}>Special Instructions for Driver</label>
                  <input
                    type="text"
                    placeholder="e.g. Goods at reception / ring warehouse buzzer"
                    maxLength={100}
                    value={specialInstruction}
                    onChange={e => setSpecialInstruction(e.target.value)}
                    style={inputStyle}
                  />
                  <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
                    Max 100 characters. Cross-border pickups automatically include customs declarations.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div style={{
              marginTop: 20, padding: '16px 18px', borderRadius: 8,
              background: 'rgba(233,30,140,0.08)', border: '1px solid rgba(233,30,140,0.3)',
              color: '#BE185D', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={18} style={{ flexShrink: 0 }} />
                <span><strong>Booking Failed:</strong> {errorMessage}</span>
              </div>
              {errorDetails && errorDetails.raw && (
                <div style={{ marginTop: 4, background: '#fff', padding: '10px 14px', borderRadius: 6, border: '1px solid rgba(233,30,140,0.2)' }}>
                  <div style={{ fontWeight: 700, color: '#9D174D', marginBottom: 4, fontSize: 12 }}>
                    UPS Response Details (HTTP {errorDetails.status || 400}):
                  </div>
                  <pre style={{ margin: 0, padding: 8, background: '#F8FAFC', borderRadius: 4, overflowX: 'auto', maxHeight: 180, fontFamily: 'monospace', fontSize: 11.5, color: '#0F172A', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {typeof errorDetails.raw === 'string' ? errorDetails.raw : JSON.stringify(errorDetails.raw, null, 2)}
                  </pre>
                  {errorDetails.request && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontWeight: 700, color: '#475569', marginBottom: 4, fontSize: 12 }}>Payload Sent:</div>
                      <pre style={{ margin: 0, padding: 8, background: '#F8FAFC', borderRadius: 4, overflowX: 'auto', maxHeight: 180, fontFamily: 'monospace', fontSize: 11.5, color: '#0F172A', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {JSON.stringify(errorDetails.request, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Success Result Box */}
          {successResult && (
            <div style={{
              marginTop: 20, padding: '16px 20px', borderRadius: 10,
              background: 'rgba(0,200,83,0.1)', border: '1px solid rgba(0,200,83,0.3)',
              color: '#065F46', display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 15, color: '#047857' }}>
                <CheckCircle2 size={20} />
                Collection Successfully Booked with UPS!
              </div>
              <div style={{ fontSize: 13 }}>
                <strong>Pickup Request Number (PRN):</strong>{' '}
                <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 15, color: '#7B2FBE' }}>
                  {successResult.prn || 'Assigned'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#065F46' }}>
                Status: {successResult.rateStatus || 'Confirmed'} · A driver pickup has been dispatched for the requested date window.
              </div>
            </div>
          )}

          {/* Actions Bar */}
          <div style={{ marginTop: 24, paddingTop: 18, borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 14 }}>
            <button
              type="submit"
              disabled={bookMutation.isPending}
              style={{
                padding: '10px 24px', borderRadius: 8, background: '#7B2FBE',
                color: '#fff', border: 'none', fontSize: 14, fontWeight: 600,
                cursor: bookMutation.isPending ? 'not-allowed' : 'pointer',
                opacity: bookMutation.isPending ? 0.7 : 1,
                display: 'flex', alignItems: 'center', gap: 8
              }}
            >
              <Truck size={16} />
              {bookMutation.isPending ? 'Booking with UPS…' : 'Book UPS Collection'}
            </button>
          </div>
        </form>
      </div>

      {/* Recent Collections History Table */}
      <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', margin: 0 }}>Recent UPS Collections</h2>
            <div style={{ fontSize: 12, color: '#64748B' }}>Real-time status of driver pickup bookings</div>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#F8FAFC', color: '#64748B', textAlign: 'left' }}>
                <th style={th}>PRN</th>
                <th style={th}>Booked At</th>
                <th style={th}>Pickup Window</th>
                <th style={th}>Contact / Company</th>
                <th style={th}>Address</th>
                <th style={th}>Parcels</th>
                <th style={th}>Tracking #</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={9} style={{ ...td, textAlign: 'center', color: '#94A3B8', padding: 24 }}>
                    Loading collections…
                  </td>
                </tr>
              )}
              {!isLoading && collections.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ ...td, textAlign: 'center', color: '#94A3B8', padding: 24 }}>
                    No collections booked yet. Use the form above to schedule a collection with UPS.
                  </td>
                </tr>
              )}
              {collections.map(c => {
                const isCancelled = c.status === 'cancelled';
                let bookedDateStr = '—';
                let bookedTimeStr = '';
                if (c.created_at) {
                  try {
                    const d = new Date(c.created_at);
                    if (!isNaN(d.getTime())) {
                      bookedDateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
                      bookedTimeStr = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                    }
                  } catch (_) {}
                }
                return (
                  <tr key={c.id || c.prn || Math.random()} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                    <td style={{ ...td, fontWeight: 700, fontFamily: 'monospace', color: '#7B2FBE' }}>
                      {c.prn || '—'}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {bookedDateStr}{' '}
                      {bookedTimeStr && <span style={{ color: '#94A3B8', fontSize: 11 }}>{bookedTimeStr}</span>}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <div style={{ fontWeight: 600, color: '#0F172A' }}>{c.pickup_date || '—'}</div>
                      <div style={{ fontSize: 11, color: '#64748B' }}>{c.ready_time || '09:00'} – {c.close_time || '17:00'}</div>
                    </td>
                    <td style={td}>
                      <div style={{ fontWeight: 600, color: '#0F172A' }}>{c.company_name || c.contact_name || '—'}</div>
                      {c.phone && <div style={{ fontSize: 11, color: '#64748B' }}>{c.phone}</div>}
                    </td>
                    <td style={{ ...td, maxWidth: 220 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {[c.address_line, c.city, c.postal_code].filter(Boolean).join(', ') || '—'}
                      </div>
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {c.parcels || 1} pkg {c.total_weight_kg ? `· ${c.total_weight_kg}kg` : ''}
                    </td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>
                      {c.tracking_number ? (
                        <span style={{ background: 'rgba(0,188,212,0.1)', color: '#00838F', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>
                          {c.tracking_number}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={td}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 700,
                        textTransform: 'uppercase',
                        background: c.status === 'booked' ? 'rgba(0,200,83,0.12)' : (c.status === 'cancelled' ? 'rgba(233,30,140,0.12)' : 'rgba(245,158,11,0.12)'),
                        color: c.status === 'booked' ? '#00C853' : (c.status === 'cancelled' ? '#E91E8C' : '#F59E0B'),
                      }}>
                        {c.status}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {c.prn && !isCancelled ? (
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <button
                            onClick={() => openReschedule(c)}
                            style={{
                              padding: '4px 10px', borderRadius: 6, background: '#F1F5F9',
                              border: '1px solid rgba(0,0,0,0.08)', fontSize: 11, fontWeight: 600,
                              color: '#334155', cursor: 'pointer'
                            }}
                          >
                            Reschedule
                          </button>
                          <button
                            onClick={() => handleCancel(c.prn)}
                            disabled={cancelMutation.isPending}
                            style={{
                              padding: '4px 10px', borderRadius: 6, background: 'rgba(233,30,140,0.08)',
                              border: '1px solid rgba(233,30,140,0.2)', fontSize: 11, fontWeight: 600,
                              color: '#E91E8C', cursor: 'pointer'
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <span style={{ color: '#94A3B8', fontSize: 12 }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reschedule Modal */}
      {rescheduleModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          padding: 16,
        }}>
          <div style={{
            background: '#fff', borderRadius: 14, width: '100%', maxWidth: 440,
            overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)',
          }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#0F172A' }}>Reschedule Collection</h3>
                <div style={{ fontSize: 12, color: '#64748B' }}>PRN: {rescheduleModal.prn}</div>
              </div>
              <button onClick={() => setRescheduleModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleRescheduleSubmit} style={{ padding: 20 }}>
              <p style={{ fontSize: 12.5, color: '#64748B', marginTop: 0, marginBottom: 14 }}>
                This will cancel the current booking with UPS and request a new driver pickup window.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={labelStyle}>New Pickup Date *</label>
                  <input
                    type="date"
                    value={reschedDate}
                    onChange={e => setReschedDate(e.target.value)}
                    style={inputStyle}
                    required
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={labelStyle}>Ready Time</label>
                    <input
                      type="time"
                      value={reschedReady}
                      onChange={e => setReschedReady(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Close Time</label>
                    <input
                      type="time"
                      value={reschedClose}
                      onChange={e => setReschedClose(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                </div>

                <div>
                  <label style={labelStyle}>Special Instructions</label>
                  <input
                    type="text"
                    value={reschedInstructions}
                    onChange={e => setReschedInstructions(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </div>

              <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setRescheduleModal(null)}
                  style={{
                    padding: '8px 14px', borderRadius: 8, background: '#F1F5F9',
                    border: '1px solid rgba(0,0,0,0.08)', fontSize: 13, fontWeight: 600,
                    color: '#475569', cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={rescheduleMutation.isPending}
                  style={{
                    padding: '8px 18px', borderRadius: 8, background: '#7B2FBE',
                    border: 'none', fontSize: 13, fontWeight: 600, color: '#fff',
                    cursor: rescheduleMutation.isPending ? 'not-allowed' : 'pointer',
                    opacity: rescheduleMutation.isPending ? 0.7 : 1,
                  }}
                >
                  {rescheduleMutation.isPending ? 'Rescheduling…' : 'Confirm Reschedule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const labelStyle = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: '#475569',
  marginBottom: 4,
};

const inputStyle = {
  width: '100%',
  padding: '8px 11px',
  borderRadius: 8,
  border: '1px solid rgba(0,0,0,0.12)',
  fontSize: 13,
  color: '#0F172A',
  background: '#fff',
  outline: 'none',
  boxSizing: 'border-box',
};

const th = { padding: '11px 14px', fontWeight: 600, fontSize: 12 };
const td = { padding: '12px 14px', color: '#334155' };
