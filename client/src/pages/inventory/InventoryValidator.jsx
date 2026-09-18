import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Search, Play, RefreshCw, Star, Download } from 'lucide-react';
import { listCustomers } from '../../api/customers';
import { inventoryFields, startInventoryValidation, getInventoryValidation } from '../../api/inventory';
import SearchableSelect from '../../components/SearchableSelect';

const HEADER = '#0B1220', TITLE = '#0F172A', MUTED = '#64748B', ACCENT = '#0056FB';
const GREEN = '#16A34A', RED = '#DC2626', AMBER = '#D97706';
const SHADOW = '0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.10)';

const pctColour = (pct) => (pct >= 100 ? GREEN : pct >= 95 ? AMBER : RED);

export default function InventoryValidator() {
  const [scope, setScope] = useState('customer');        // customer | all
  const [customerId, setCustomerId] = useState('');
  const [selected, setSelected] = useState([]);          // field paths
  const [search, setSearch] = useState('');
  const [favs, setFavs] = useState(() => { try { return JSON.parse(localStorage.getItem('c9_inv_fav_fields') || '[]'); } catch { return []; } });
  const [hideDetail, setHideDetail] = useState(() => localStorage.getItem('c9_inv_hide_detail') === '1');
  const [runId, setRunId] = useState(null);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState(null);

  const { data: custData } = useQuery({ queryKey: ['customers-list-inv'], queryFn: () => listCustomers({ limit: 500, sort: 'business_name', order: 'asc' }) });
  const customers = Array.isArray(custData) ? custData : (custData?.data || custData?.rows || custData?.customers || []);

  // The field schema is the same for every customer and rarely changes, so we
  // fetch the cached list once and reuse it — no Helm call when switching
  // customers. "Rediscover" forces a fresh pull.
  const { data: fieldsData, isLoading: fieldsLoading, error: fieldsErr, refetch: refetchFields } = useQuery({
    queryKey: ['inv-fields'],
    queryFn: () => inventoryFields(),
    staleTime: Infinity,
  });
  // Detail-level fields are hidden from the picker (per request) — the list-level
  // fields cover what's needed and avoid the per-item detail call.
  const fields = (fieldsData?.fields || []).filter(f => f.source !== 'detail');
  const [rediscovering, setRediscovering] = useState(false);
  async function rediscover() {
    setRediscovering(true);
    try { await inventoryFields(true); await refetchFields(); } catch { /* keep old list */ } finally { setRediscovering(false); }
  }

  const { data: run } = useQuery({
    queryKey: ['inv-run', runId],
    queryFn: () => getInventoryValidation(runId),
    enabled: !!runId,
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 1000 : false),
  });

  const isFav = (p) => favs.includes(p);
  const shownFields = useMemo(() => {
    const q = search.trim().toLowerCase();
    const arr = fields.filter(f => {
      if (q && !(f.path.toLowerCase().includes(q) || (f.label || '').toLowerCase().includes(q))) return false;
      // Hide detail-level fields when asked — but never hide a pinned favourite.
      if (hideDetail && f.source === 'detail' && !favs.includes(f.path)) return false;
      return true;
    });
    // Favourites float to the top, keeping their existing order otherwise.
    return arr.slice().sort((a, b) => (favs.includes(b.path) ? 1 : 0) - (favs.includes(a.path) ? 1 : 0));
  }, [fields, search, hideDetail, favs]);

  const toggleField = (p) => setSelected(s => s.includes(p) ? s.filter(x => x !== p) : [...s, p]);
  const toggleFav = (p) => setFavs(prev => {
    const next = prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p];
    localStorage.setItem('c9_inv_fav_fields', JSON.stringify(next));
    return next;
  });
  const setHide = (v) => { setHideDetail(v); localStorage.setItem('c9_inv_hide_detail', v ? '1' : '0'); };

  async function interrogate() {
    setErr(null); setStarting(true); setRunId(null);
    try {
      const r = await startInventoryValidation({ scope, customerId: scope === 'customer' ? customerId : null, fields: selected });
      setRunId(r.run_id);
    } catch (e) {
      setErr(e?.response?.data?.error || 'Could not start the interrogation.');
    } finally { setStarting(false); }
  }

  const canRun = selected.length > 0 && (scope === 'all' || !!customerId) && !starting;
  const running = run?.status === 'running' || starting;
  const result = run?.status === 'ok' ? run.result : null;

  return (
    <div style={{ width: '100%', maxWidth: 'none' }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: HEADER, margin: '0 0 4px', letterSpacing: -0.6, display: 'flex', alignItems: 'center', gap: 9 }}>
          <ClipboardCheck size={22} /> Inventory Validator
        </h1>
        <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>Interrogate a customer’s inventory (or all of them) for missing data on the fields you choose.</p>
      </div>

      {/* Controls */}
      <div style={{ background: '#fff', borderRadius: 14, boxShadow: SHADOW, padding: 18, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Seg value={scope} onChange={(v) => { setScope(v); setRunId(null); }} options={[{ v: 'customer', l: 'One customer' }, { v: 'all', l: 'All customers' }]} />
          {scope === 'customer' && (
            <SearchableSelect
              value={customerId}
              onChange={(v) => { setCustomerId(v); setRunId(null); }}
              options={customers.map(c => ({ value: c.id, label: c.business_name }))}
              placeholder="Select a customer…"
              minWidth={220}
            />
          )}
          <div style={{ flex: 1 }} />
          <button onClick={interrogate} disabled={!canRun} style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', borderRadius: 9, padding: '9px 16px', fontSize: 13, fontWeight: 700,
            background: canRun ? ACCENT : '#CBD5E1', color: '#fff', cursor: canRun ? 'pointer' : 'default' }}>
            {running ? <RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={15} />}
            {running ? 'Interrogating…' : 'Interrogate'}
          </button>
        </div>
        {err && <div style={{ marginTop: 10, color: RED, fontSize: 12.5, fontWeight: 600 }}>{err}</div>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 380px) 1fr', gap: 16, alignItems: 'start' }}>
        {/* Field picker */}
        <div style={{ background: '#fff', borderRadius: 14, boxShadow: SHADOW, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: TITLE }}>Fields {fields.length ? `(${selected.length}/${fields.length})` : ''}</span>
            {fields.length > 0 && (
              <span style={{ display: 'flex', gap: 10 }}>
                <a onClick={() => setSelected(fields.map(f => f.path))} style={{ fontSize: 11.5, color: ACCENT, cursor: 'pointer', fontWeight: 600 }}>All</a>
                <a onClick={() => setSelected([])} style={{ fontSize: 11.5, color: MUTED, cursor: 'pointer', fontWeight: 600 }}>Clear</a>
              </span>
            )}
          </div>

          {(
            fieldsLoading ? <div style={{ color: MUTED, fontSize: 13, padding: '20px 0' }}>Loading fields…</div>
            : fieldsErr ? <div style={{ color: RED, fontSize: 12.5 }}>{fieldsErr?.response?.data?.error || 'Could not load fields.'}</div>
            : fields.length === 0 ? (
              <div style={{ color: MUTED, fontSize: 13, padding: '8px 0' }}>
                No field list cached yet.
                <button onClick={rediscover} disabled={rediscovering} style={{ marginLeft: 8, border: '1px solid #E2E8F0', background: '#fff', borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 600, color: ACCENT, cursor: 'pointer' }}>{rediscovering ? 'Discovering…' : 'Discover from Helm'}</button>
              </div>
            )
            : (
              <>
                <div style={{ position: 'relative', marginBottom: 8 }}>
                  <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: '#94A3B8' }} />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter fields…"
                    style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #E2E8F0', borderRadius: 8, padding: '7px 10px 7px 30px', fontSize: 12.5, fontFamily: 'inherit' }} />
                </div>
                {fields.some(f => f.source === 'detail') && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, fontSize: 12, color: MUTED, cursor: 'pointer' }}>
                    <input type="checkbox" checked={hideDetail} onChange={e => setHide(e.target.checked)} />
                    Hide detail fields <span style={{ color: '#94A3B8' }}>(pinned ones stay)</span>
                  </label>
                )}
                <div style={{ maxHeight: 460, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {shownFields.map(f => (
                    <div key={f.path} style={{ display: 'flex', alignItems: 'flex-start', gap: 4, padding: '7px 8px', borderRadius: 7, background: selected.includes(f.path) ? '#F5F8FF' : 'transparent' }}>
                      <button onClick={() => toggleFav(f.path)} title={isFav(f.path) ? 'Unpin' : 'Pin to top'} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '1px 2px', marginTop: 1, lineHeight: 0, flexShrink: 0 }}>
                        <Star size={14} fill={isFav(f.path) ? '#F59E0B' : 'none'} color={isFav(f.path) ? '#F59E0B' : '#CBD5E1'} />
                      </button>
                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, flex: 1, minWidth: 0, cursor: 'pointer' }}>
                        <input type="checkbox" checked={selected.includes(f.path)} onChange={() => toggleField(f.path)} style={{ marginTop: 2 }} />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: TITLE }}>{f.label}</span>
                            {f.source === 'detail' && <span style={{ fontSize: 9.5, fontWeight: 700, color: '#7C3AED', background: '#F3E8FF', borderRadius: 5, padding: '1px 5px' }}>DETAIL</span>}
                          </span>
                          <span style={{ display: 'block', fontSize: 11, color: '#94A3B8', fontFamily: 'ui-monospace, monospace' }}>{f.path}</span>
                          {f.sampleValue != null && <span style={{ display: 'block', fontSize: 11, color: MUTED }}>e.g. {f.sampleValue}</span>}
                        </span>
                      </label>
                    </div>
                  ))}
                </div>
                {fields.some(f => f.source === 'detail') && !hideDetail && (
                  <div style={{ marginTop: 10, fontSize: 11, color: '#94A3B8' }}>DETAIL fields need an extra API call per item — slower on big catalogues.</div>
                )}
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 10.5, color: '#94A3B8' }}>Cached list{fieldsData?.generated_at ? ` · ${new Date(fieldsData.generated_at).toLocaleDateString('en-GB')}` : ''}</span>
                  <button onClick={rediscover} disabled={rediscovering} title="Re-pull the field list from Helm" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid #E2E8F0', background: '#fff', borderRadius: 8, padding: '4px 9px', fontSize: 11, fontWeight: 600, color: MUTED, cursor: rediscovering ? 'default' : 'pointer' }}>
                    <RefreshCw size={11} style={{ animation: rediscovering ? 'spin 1s linear infinite' : 'none' }} /> {rediscovering ? 'Rediscovering…' : 'Rediscover'}
                  </button>
                </div>
              </>
            )
          )}
        </div>

        {/* Results */}
        <div style={{ minWidth: 0 }}>
          {!runId ? (
            <div style={{ background: '#fff', borderRadius: 14, boxShadow: SHADOW, padding: '48px 24px', textAlign: 'center', color: MUTED, fontSize: 13.5 }}>
              Select fields on the left and hit <b>Interrogate</b> to see which inventory items are missing data.
            </div>
          ) : running ? (
            <div style={{ background: '#fff', borderRadius: 14, boxShadow: SHADOW, padding: '32px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <RefreshCw size={22} style={{ animation: 'spin 1s linear infinite', color: ACCENT, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: TITLE }}>
                      {run?.scope === 'all' && run?.total_customers
                        ? `Interrogating Customers (${run.customer_index || 0} of ${run.total_customers})`
                        : 'Interrogating Inventory…'}
                    </div>
                    <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>
                      {run?.current_customer ? `Current: ${run.current_customer}` : 'Connecting to Helm API…'}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#F0FDF4', border: '1px solid #BBF7D0', padding: '5px 11px', borderRadius: 20 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: GREEN, display: 'inline-block' }} />
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: '#166534' }}>Safe Rate-Limit Pacing Active</span>
                </div>
              </div>

              {/* Progress Bar */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, color: MUTED, marginBottom: 6 }}>
                  <span>Customer Sweep Progress</span>
                  <span style={{ color: ACCENT, fontWeight: 800 }}>{run?.percent != null ? `${run.percent}%` : 'Starting…'}</span>
                </div>
                <div style={{ height: 10, background: '#F1F5F9', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.max(run?.percent || 5, 5)}%`,
                    height: '100%',
                    background: `linear-gradient(90deg, ${ACCENT}, #3B82F6)`,
                    transition: 'width 0.3s ease',
                    borderRadius: 6,
                  }} />
                </div>
              </div>

              {/* Live Metric Counters */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                <div style={{ background: '#F8FAFC', borderRadius: 10, padding: '12px 14px', border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: 11.5, color: MUTED, fontWeight: 600 }}>Physical Items Checked</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: TITLE, marginTop: 3 }}>
                    {(run?.items_checked || 0).toLocaleString()}
                  </div>
                </div>
                <div style={{ background: '#F8FAFC', borderRadius: 10, padding: '12px 14px', border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: 11.5, color: MUTED, fontWeight: 600 }}>Discrepancies / Outliers</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: (run?.issues_found || 0) > 0 ? AMBER : TITLE, marginTop: 3 }}>
                    {(run?.issues_found || 0).toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
          ) : run?.status === 'error' ? (
            <div style={{ background: '#fff', borderRadius: 14, boxShadow: SHADOW, padding: 24, color: RED, fontSize: 13 }}>Interrogation failed: {run.error}</div>
          ) : result ? (
            <Results run={run} result={result} scope={run.scope} />
          ) : null}
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function Results({ run, result, scope }) {
  const [activeTab, setActiveTab] = useState('sanity'); // 'sanity' | 'missing' | 'customers'
  const [dismissedMap, setDismissedMap] = useState({});
  const [dismissing, setDismissing] = useState(null);

  const sanityList = (result.sanityAlerts || []).filter(item => {
    const activeFlags = item.flags.filter(fl => !dismissedMap[`${item.sku}::${fl.type}`]);
    return activeFlags.length > 0;
  });

  const total = run.items_checked || 0;
  const missingCount = run.issues_found || 0;
  const sanityCount = sanityList.length;

  const th = { textAlign: 'left', padding: '9px 12px', fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' };
  const td = { padding: '10px 12px', fontSize: 13, color: TITLE, borderTop: '1px solid #F1F5F9', verticalAlign: 'top' };

  async function handleDismiss(item, flag) {
    const key = `${item.sku}::${flag.type}`;
    setDismissing(key);
    try {
      await dismissAlert({
        customerId: item.customer_id,
        sku: item.sku,
        alertType: flag.type,
        reason: flag.desc,
      });
      setDismissedMap(prev => ({ ...prev, [key]: true }));
    } catch (e) {
      console.warn('Failed to dismiss alert:', e.message);
    } finally {
      setDismissing(null);
    }
  }

  function exportMissingCsv() {
    const rows = result.issues || [];
    if (!rows.length) return;
    const esc = (v) => {
      const s = String(v ?? '');
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headers = ['Customer', 'SKU', 'Product Name', 'Helm Inventory ID', 'Missing Fields', 'Missing Count'];
    const lines = [
      headers.join(','),
      ...rows.map(r => [
        r.customer || '',
        r.sku || '',
        r.name || '',
        r.inventory_id || '',
        Array.isArray(r.missing) ? r.missing.join('; ') : '',
        Array.isArray(r.missing) ? r.missing.length : 0,
      ].map(esc).join(','))
    ];
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const custTag = scope === 'customer' && rows[0]?.customer ? `-${rows[0].customer.replace(/[^a-zA-Z0-9_-]/g, '_')}` : '-all-customers';
    a.href = url;
    a.download = `inventory-missing-data${custTag}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportSanityCsv() {
    const rows = sanityList || [];
    if (!rows.length) return;
    const esc = (v) => {
      const s = String(v ?? '');
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headers = ['Customer', 'SKU', 'Product Name', 'Helm Inventory ID', 'Dimensions', 'Weight', 'Alert Title', 'Alert Description'];
    const lines = [
      headers.join(','),
      ...rows.flatMap(r => {
        const activeFlags = r.flags.filter(fl => !dismissedMap[`${r.sku}::${fl.type}`]);
        return activeFlags.map(fl => [
          r.customer || '',
          r.sku || '',
          r.name || '',
          r.inventory_id || '',
          r.dimensions || '',
          r.weight || '',
          fl.title || fl.type || '',
          fl.desc || '',
        ].map(esc).join(','));
      })
    ];
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const custTag = scope === 'customer' && rows[0]?.customer ? `-${rows[0].customer.replace(/[^a-zA-Z0-9_-]/g, '_')}` : '-all-customers';
    a.href = url;
    a.download = `inventory-sanity-discrepancies${custTag}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Overview Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <div style={{ background: '#fff', borderRadius: 12, padding: 14, boxShadow: SHADOW, borderLeft: `4px solid ${sanityCount ? AMBER : GREEN}` }}>
          <div style={{ fontSize: 11.5, color: MUTED, fontWeight: 600 }}>Dimensional Sanity Alerts</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: sanityCount ? AMBER : GREEN, marginTop: 2 }}>
            {sanityCount.toLocaleString()} <span style={{ fontSize: 13, fontWeight: 600, color: MUTED }}>potential outliers</span>
          </div>
        </div>
        <div style={{ background: '#fff', borderRadius: 12, padding: 14, boxShadow: SHADOW, borderLeft: `4px solid ${missingCount ? RED : GREEN}` }}>
          <div style={{ fontSize: 11.5, color: MUTED, fontWeight: 600 }}>Missing Field Cells</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: missingCount ? RED : GREEN, marginTop: 2 }}>
            {missingCount.toLocaleString()} <span style={{ fontSize: 13, fontWeight: 600, color: MUTED }}>empty values</span>
          </div>
        </div>
        <div style={{ background: '#fff', borderRadius: 12, padding: 14, boxShadow: SHADOW, borderLeft: `4px solid ${ACCENT}` }}>
          <div style={{ fontSize: 11.5, color: MUTED, fontWeight: 600 }}>Items Interrogated</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: TITLE, marginTop: 2 }}>
            {total.toLocaleString()} <span style={{ fontSize: 13, fontWeight: 600, color: MUTED }}>SKUs checked</span>
          </div>
        </div>
      </div>

      {/* Tabs & Export Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #E2E8F0', paddingBottom: 8, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            onClick={() => setActiveTab('sanity')}
            style={{
              border: 'none', background: activeTab === 'sanity' ? ACCENT : 'transparent',
              color: activeTab === 'sanity' ? '#fff' : TITLE, borderRadius: 8, padding: '7px 14px',
              fontSize: 12.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7,
            }}>
            <span>📐 Dimensional Sanity</span>
            {sanityCount > 0 && (
              <span style={{ background: activeTab === 'sanity' ? 'rgba(255,255,255,0.25)' : '#FEF3C7', color: activeTab === 'sanity' ? '#fff' : AMBER, borderRadius: 10, padding: '1px 6px', fontSize: 11 }}>
                {sanityCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('missing')}
            style={{
              border: 'none', background: activeTab === 'missing' ? ACCENT : 'transparent',
              color: activeTab === 'missing' ? '#fff' : TITLE, borderRadius: 8, padding: '7px 14px',
              fontSize: 12.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7,
            }}>
            <span>📋 Missing Field Data</span>
            {result.issues.length > 0 && (
              <span style={{ background: activeTab === 'missing' ? 'rgba(255,255,255,0.25)' : '#FEE2E2', color: activeTab === 'missing' ? '#fff' : RED, borderRadius: 10, padding: '1px 6px', fontSize: 11 }}>
                {result.issues.length}
              </span>
            )}
          </button>

          {scope === 'all' && (
            <button
              onClick={() => setActiveTab('customers')}
              style={{
                border: 'none', background: activeTab === 'customers' ? ACCENT : 'transparent',
                color: activeTab === 'customers' ? '#fff' : TITLE, borderRadius: 8, padding: '7px 14px',
                fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
              }}>
              🏢 Customers Breakdown
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={exportMissingCsv}
            disabled={result.issues.length === 0}
            title="Download CSV report of all items with missing fields"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              border: '1px solid #CBD5E1', background: '#fff', borderRadius: 8,
              padding: '6px 12px', fontSize: 12, fontWeight: 700,
              color: result.issues.length ? TITLE : '#94A3B8',
              cursor: result.issues.length ? 'pointer' : 'default',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
            }}>
            <Download size={14} color={result.issues.length ? ACCENT : '#94A3B8'} />
            Export Missing Data (CSV)
          </button>
          {sanityList.length > 0 && (
            <button
              onClick={exportSanityCsv}
              title="Download CSV report of measurement discrepancies"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                border: '1px solid #CBD5E1', background: '#fff', borderRadius: 8,
                padding: '6px 12px', fontSize: 12, fontWeight: 700,
                color: TITLE, cursor: 'pointer',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              }}>
              <Download size={14} color={AMBER} />
              Export Sanity Alerts (CSV)
            </button>
          )}
        </div>
      </div>

      {/* ── TAB 1: DIMENSIONAL SANITY ── */}
      {activeTab === 'sanity' && (
        <div style={{ background: '#fff', borderRadius: 14, boxShadow: SHADOW, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: TITLE }}>Potential Measurement Discrepancies</div>
              <div style={{ fontSize: 12, color: MUTED }}>Automatic physical sanity checks (aspect ratio, density, zero dimensions, variant outliers). Dismiss any acceptable SKU permanently.</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {sanityList.length > 0 && (
                <button
                  onClick={exportSanityCsv}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    border: '1px solid #E2E8F0', background: '#F8FAFC', borderRadius: 6,
                    padding: '4px 10px', fontSize: 11.5, fontWeight: 600, color: AMBER, cursor: 'pointer'
                  }}>
                  <Download size={13} /> Download CSV
                </button>
              )}
              {Object.keys(dismissedMap).length > 0 && (
                <span style={{ fontSize: 11.5, fontWeight: 600, color: GREEN, background: '#DCFCE7', padding: '3px 8px', borderRadius: 6 }}>
                  ✓ {Object.keys(dismissedMap).length} dismissed
                </span>
              )}
            </div>
          </div>

          {sanityList.length === 0 ? (
            <div style={{ padding: '36px 16px', color: GREEN, fontSize: 13.5, fontWeight: 600, textAlign: 'center' }}>
              ✓ All measured dimensions and weights look physically sound with no outliers.
            </div>
          ) : (
            <div style={{ overflowX: 'auto', maxHeight: 600, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#F8FAFC', position: 'sticky', top: 0, zIndex: 5 }}>
                    <th style={th}>SKU / Product</th>
                    {scope === 'all' && <th style={th}>Customer</th>}
                    <th style={th}>Dimensions</th>
                    <th style={th}>Weight</th>
                    <th style={th}>Detected Sanity Alert</th>
                    <th style={{ ...th, textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sanityList.map((it, idx) => {
                    const activeFlags = it.flags.filter(fl => !dismissedMap[`${it.sku}::${fl.type}`]);
                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                        <td style={{ ...td, maxWidth: 220 }}>
                          <div style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: TITLE, fontSize: 12 }}>{it.sku}</div>
                          <div style={{ fontSize: 11.5, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.name}>{it.name}</div>
                        </td>
                        {scope === 'all' && <td style={{ ...td, fontWeight: 600, color: '#334155' }}>{it.customer}</td>}
                        <td style={{ ...td, fontFamily: 'ui-monospace, monospace', color: '#334155', fontSize: 12 }}>{it.dimensions}</td>
                        <td style={{ ...td, fontFamily: 'ui-monospace, monospace', color: '#334155', fontSize: 12 }}>{it.weight}</td>
                        <td style={td}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {activeFlags.map((fl, fi) => (
                              <div key={fi} style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 6, padding: '4px 8px' }}>
                                <div style={{ fontSize: 11.5, fontWeight: 700, color: '#92400E' }}>⚠️ {fl.title}</div>
                                <div style={{ fontSize: 11, color: '#B45309', marginTop: 1 }}>{fl.desc}</div>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td style={{ ...td, textAlign: 'right', verticalAlign: 'middle' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                            {activeFlags.map((fl, fi) => {
                              const isBusy = dismissing === `${it.sku}::${fl.type}`;
                              return (
                                <button
                                  key={fi}
                                  onClick={() => handleDismiss(it, fl)}
                                  disabled={isBusy}
                                  title="Accept measurement and permanently dismiss this alert"
                                  style={{
                                    border: '1px solid #CBD5E1', background: '#fff', borderRadius: 6,
                                    padding: '4px 9px', fontSize: 11, fontWeight: 600, color: '#475569',
                                    cursor: isBusy ? 'default' : 'pointer', opacity: isBusy ? 0.6 : 1,
                                  }}>
                                  {isBusy ? 'Dismissing…' : 'Dismiss Alert'}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: MISSING FIELDS ── */}
      {activeTab === 'missing' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Completion bars */}
          <div style={{ background: '#fff', borderRadius: 14, boxShadow: SHADOW, padding: 18 }}>
            <div style={{ fontSize: 13.5, color: TITLE, fontWeight: 600, marginBottom: 14 }}>
              Field Coverage ({result.fields.length} selected fields)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {result.fields.map(f => {
                const s = result.byField[f] || { missing: 0, total: 0 };
                const pct = s.total ? Math.round(((s.total - s.missing) / s.total) * 100) : 100;
                return (
                  <div key={f}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                      <span style={{ fontWeight: 600, color: TITLE, fontFamily: 'ui-monospace, monospace' }}>{f}</span>
                      <span style={{ color: pctColour(pct), fontWeight: 700 }}>{pct}% complete · {s.missing.toLocaleString()} missing</span>
                    </div>
                    <div style={{ height: 7, background: '#F1F5F9', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: pctColour(pct) }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Missing items table */}
          <div style={{ background: '#fff', borderRadius: 14, boxShadow: SHADOW, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: TITLE }}>
                Items with Missing Values {result.issues.length ? `(${result.issues.length}${result.truncated_issues ? '+' : ''})` : ''}
              </div>
              {result.issues.length > 0 && (
                <button
                  onClick={exportMissingCsv}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    border: '1px solid #E2E8F0', background: '#F8FAFC', borderRadius: 6,
                    padding: '4px 10px', fontSize: 11.5, fontWeight: 600, color: ACCENT, cursor: 'pointer'
                  }}>
                  <Download size={13} /> Download CSV
                </button>
              )}
            </div>
            {result.issues.length === 0 ? (
              <div style={{ padding: '24px 16px', color: GREEN, fontSize: 13, fontWeight: 600 }}>No missing data on the selected fields. ✓</div>
            ) : (
              <div style={{ overflowX: 'auto', maxHeight: 560, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#F8FAFC', position: 'sticky', top: 0, zIndex: 5 }}>
                      <th style={th}>SKU</th><th style={th}>Name</th>{scope === 'all' && <th style={th}>Customer</th>}<th style={th}>Missing fields</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.issues.map((it, i) => (
                      <tr key={i}>
                        <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{it.sku || '—'}</td>
                        <td style={td}>{it.name || '—'}</td>
                        {scope === 'all' && <td style={td}>{it.customer}</td>}
                        <td style={td}>
                          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                            {it.missing.map(m => (
                              <span key={m} style={{ fontSize: 11, fontWeight: 600, color: RED, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 5, padding: '1px 6px', fontFamily: 'ui-monospace, monospace' }}>
                                {m}
                              </span>
                            ))}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 3: CUSTOMERS BREAKDOWN ── */}
      {activeTab === 'customers' && scope === 'all' && result.byCustomer?.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 14, boxShadow: SHADOW, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', fontSize: 13.5, fontWeight: 700, color: TITLE }}>Breakdown by Customer</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#F8FAFC' }}>
                  <th style={th}>Customer</th>
                  <th style={{ ...th, textAlign: 'right' }}>Items</th>
                  <th style={{ ...th, textAlign: 'right' }}>Missing Data</th>
                  <th style={{ ...th, textAlign: 'right' }}>Sanity Alerts</th>
                  <th style={{ ...th, textAlign: 'right' }}>Complete</th>
                </tr>
              </thead>
              <tbody>
                {[...result.byCustomer].sort((a, b) => (b.with_issues + b.sanity_alerts) - (a.with_issues + a.sanity_alerts)).map(c => (
                  <tr key={c.customer_id}>
                    <td style={{ ...td, fontWeight: 600 }}>{c.customer}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{c.items.toLocaleString()}</td>
                    <td style={{ ...td, textAlign: 'right', color: c.with_issues ? RED : MUTED, fontWeight: 700 }}>{c.with_issues.toLocaleString()}</td>
                    <td style={{ ...td, textAlign: 'right', color: c.sanity_alerts ? AMBER : MUTED, fontWeight: 700 }}>{(c.sanity_alerts || 0).toLocaleString()}</td>
                    <td style={{ ...td, textAlign: 'right', color: pctColour(c.complete_pct ?? 100), fontWeight: 700 }}>{c.complete_pct == null ? '—' : `${c.complete_pct}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Seg({ options, value, onChange }) {
  return (
    <div style={{ display: 'inline-flex', background: '#F1F5F9', borderRadius: 9, padding: 3 }}>
      {options.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)} style={{
          border: 'none', cursor: 'pointer', borderRadius: 7, padding: '6px 13px', fontSize: 12.5, fontWeight: 600,
          background: value === o.v ? '#fff' : 'transparent', color: value === o.v ? TITLE : MUTED, boxShadow: value === o.v ? SHADOW : 'none' }}>{o.l}</button>
      ))}
    </div>
  );
}
