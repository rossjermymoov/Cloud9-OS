import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Search, Play, RefreshCw, Star } from 'lucide-react';
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
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 2500 : false),
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
            <div style={{ background: '#fff', borderRadius: 14, boxShadow: SHADOW, padding: '40px 24px', textAlign: 'center' }}>
              <RefreshCw size={22} style={{ animation: 'spin 1s linear infinite', color: ACCENT }} />
              <div style={{ fontSize: 14, fontWeight: 700, color: TITLE, margin: '12px 0 4px' }}>Interrogating Helm…</div>
              <div style={{ fontSize: 12.5, color: MUTED }}>{(run?.items_checked || 0).toLocaleString()} items checked · {(run?.issues_found || 0).toLocaleString()} with missing data{run?.scope === 'all' ? ' · sweeping all customers' : ''}</div>
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
  const total = run.items_checked || 0;
  const clean = total - (run.issues_found || 0);
  const th = { textAlign: 'left', padding: '9px 12px', fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' };
  const td = { padding: '10px 12px', fontSize: 13, color: TITLE, borderTop: '1px solid #F1F5F9', verticalAlign: 'top' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* summary */}
      <div style={{ background: '#fff', borderRadius: 14, boxShadow: SHADOW, padding: 18 }}>
        <div style={{ fontSize: 13.5, color: TITLE, fontWeight: 600, marginBottom: 14 }}>
          Checked <b>{total.toLocaleString()}</b> items · <span style={{ color: GREEN }}>{clean.toLocaleString()} complete</span> · <span style={{ color: RED }}>{(run.issues_found || 0).toLocaleString()} missing data</span>
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
        {result.item_cap_hit && <div style={{ marginTop: 12, fontSize: 11.5, color: AMBER }}>Stopped at the item cap — narrow the scope for a complete sweep.</div>}
      </div>

      {/* per-customer (all scope) */}
      {scope === 'all' && result.byCustomer?.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 14, boxShadow: SHADOW, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', fontSize: 13.5, fontWeight: 700, color: TITLE }}>By customer</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: '#F8FAFC' }}>
                <th style={th}>Customer</th><th style={{ ...th, textAlign: 'right' }}>Items</th>
                <th style={{ ...th, textAlign: 'right' }}>Missing data</th><th style={{ ...th, textAlign: 'right' }}>Complete</th>
              </tr></thead>
              <tbody>
                {[...result.byCustomer].sort((a, b) => (b.with_issues) - (a.with_issues)).map(c => (
                  <tr key={c.customer_id}>
                    <td style={{ ...td, fontWeight: 600 }}>{c.customer}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{c.items.toLocaleString()}</td>
                    <td style={{ ...td, textAlign: 'right', color: c.with_issues ? RED : MUTED, fontWeight: 700 }}>{c.with_issues.toLocaleString()}</td>
                    <td style={{ ...td, textAlign: 'right', color: pctColour(c.complete_pct ?? 100), fontWeight: 700 }}>{c.complete_pct == null ? '—' : `${c.complete_pct}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* item-level issues */}
      <div style={{ background: '#fff', borderRadius: 14, boxShadow: SHADOW, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', fontSize: 13.5, fontWeight: 700, color: TITLE }}>
          Items missing data {result.issues.length ? `(${result.issues.length}${result.truncated_issues ? '+' : ''})` : ''}
        </div>
        {result.issues.length === 0 ? (
          <div style={{ padding: '24px 16px', color: GREEN, fontSize: 13, fontWeight: 600 }}>No missing data on the selected fields. ✓</div>
        ) : (
          <div style={{ overflowX: 'auto', maxHeight: 560, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: '#F8FAFC' }}>
                <th style={th}>SKU</th><th style={th}>Name</th>{scope === 'all' && <th style={th}>Customer</th>}<th style={th}>Missing fields</th>
              </tr></thead>
              <tbody>
                {result.issues.map((it, i) => (
                  <tr key={i}>
                    <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{it.sku || '—'}</td>
                    <td style={td}>{it.name || '—'}</td>
                    {scope === 'all' && <td style={td}>{it.customer}</td>}
                    <td style={td}>
                      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {it.missing.map(m => <span key={m} style={{ fontSize: 11, fontWeight: 600, color: RED, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 5, padding: '1px 6px', fontFamily: 'ui-monospace, monospace' }}>{m}</span>)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {result.truncated_issues && <div style={{ padding: '10px 16px', fontSize: 11.5, color: AMBER }}>Showing the first {result.issues.length.toLocaleString()} items — refine fields or scope to see the rest.</div>}
      </div>
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
