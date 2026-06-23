import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Settings, Tv, Mail, MessageSquare, Banknote, Check, RefreshCw, Megaphone, UserPlus, Plug, Link2, Search, Wand2 } from 'lucide-react';
import {
  getBoardMessages, saveBoardWelcome, saveBoardUrgent, clearBoardUrgent,
  gmailStatus, gmailSyncNow, gmailDisconnect, gmailConnectUrl,
} from '../../api/settings';
import {
  xeroStatus, xeroDisconnect, xeroConnectUrl, xeroContactSearch,
  xeroMatchStatus, xeroLinkCustomer, xeroUnlinkCustomer, xeroAutoMatch,
} from '../../api/xero';

const HEADER = '#0B1220', TITLE = '#0F172A', MUTED = '#64748B', ACCENT = '#0056FB';
const GREEN = '#10B981', AMBER = '#F59E0B', RED = '#EF4444';
const SHADOW = '0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.10)';

function Card({ children, style }) {
  return <div style={{ background: '#fff', borderRadius: 14, boxShadow: SHADOW, padding: 20, ...style }}>{children}</div>;
}
const labelStyle = { fontSize: 12.5, fontWeight: 700, color: TITLE, display: 'block', marginBottom: 6 };
const inputStyle = { width: '100%', border: '1px solid #E2E8F0', borderRadius: 9, padding: '9px 11px', fontSize: 13.5, fontFamily: 'inherit', color: TITLE, boxSizing: 'border-box' };
const btn = (bg, disabled) => ({ display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', background: bg, color: '#fff', cursor: disabled ? 'default' : 'pointer', borderRadius: 9, padding: '9px 15px', fontSize: 13, fontWeight: 700, opacity: disabled ? 0.6 : 1 });
const ghostBtn = { display: 'inline-flex', alignItems: 'center', gap: 7, border: '1px solid #E2E8F0', background: '#fff', cursor: 'pointer', borderRadius: 9, padding: '8px 13px', fontSize: 12.5, fontWeight: 600, color: TITLE };

// ── Warehouse board messages ────────────────────────────────────────────────
function BoardSection() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['board-messages'], queryFn: getBoardMessages });
  const [who, setWho] = useState('');
  const [welcomeOn, setWelcomeOn] = useState(false);
  const [msg, setMsg] = useState('');
  const [mins, setMins] = useState(30);
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    if (data) { setWho(data.welcome?.who || ''); setWelcomeOn(!!data.welcome?.enabled); setMsg(data.urgent?.message || ''); }
  }, [data]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['board-messages'] });
  async function saveWelcome() { setSaving('welcome'); try { await saveBoardWelcome(welcomeOn, who); await refresh(); } finally { setSaving(null); } }
  async function showUrgent() { if (!msg.trim()) return; setSaving('urgent'); try { await saveBoardUrgent(msg.trim(), mins); await refresh(); } finally { setSaving(null); } }
  async function clearUrgent() { setSaving('clear'); try { await clearBoardUrgent(); setMsg(''); await refresh(); } finally { setSaving(null); } }

  const urgentActive = data?.urgent?.active;
  const expiresAt = data?.urgent?.expires_at ? new Date(data.urgent.expires_at) : null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 16 }}>
      {/* Welcome slide */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <UserPlus size={17} color={ACCENT} /><span style={{ fontSize: 15, fontWeight: 800, color: HEADER }}>Welcome slide</span>
        </div>
        <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 14 }}>Adds a slide to the TV rotation: “Cloud9 Fulfilment welcomes …”. Set it the morning of a visit.</div>
        <label style={labelStyle}>Who are we welcoming?</label>
        <input style={inputStyle} value={who} onChange={e => setWho(e.target.value)} placeholder="e.g. Acme Corporation" />
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 14, fontSize: 13, color: TITLE, cursor: 'pointer' }}>
          <input type="checkbox" checked={welcomeOn} onChange={e => setWelcomeOn(e.target.checked)} />
          Show the welcome slide on the board
        </label>
        <div style={{ marginTop: 16 }}>
          <button style={btn(ACCENT, saving === 'welcome')} disabled={saving === 'welcome'} onClick={saveWelcome}>
            <Check size={15} /> {saving === 'welcome' ? 'Saving…' : 'Save welcome'}
          </button>
        </div>
      </Card>

      {/* Urgent banner */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Megaphone size={17} color={RED} /><span style={{ fontSize: 15, fontWeight: 800, color: HEADER }}>Urgent banner</span>
        </div>
        <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 14 }}>Flashes a red banner across the top of the TV board for a set time, then clears itself.</div>
        {urgentActive && (
          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#92400E', background: '#FEF3C7', borderRadius: 9, padding: '9px 12px', marginBottom: 12 }}>
            ● Live now{expiresAt ? ` · clears at ${expiresAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}
          </div>
        )}
        <label style={labelStyle}>Message</label>
        <input style={inputStyle} value={msg} onChange={e => setMsg(e.target.value)} placeholder="e.g. Fire drill at 2pm — exit via bay 3" />
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginTop: 14, flexWrap: 'wrap' }}>
          <div>
            <label style={labelStyle}>Show for</label>
            <select style={{ ...inputStyle, width: 'auto' }} value={mins} onChange={e => setMins(parseInt(e.target.value))}>
              {[5, 10, 15, 30, 60, 120, 240].map(m => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} hr${m >= 120 ? 's' : ''}`}</option>)}
            </select>
          </div>
          <button style={btn(RED, saving === 'urgent')} disabled={saving === 'urgent' || !msg.trim()} onClick={showUrgent}>
            <Megaphone size={15} /> {saving === 'urgent' ? 'Posting…' : 'Show on board'}
          </button>
          {urgentActive && <button style={ghostBtn} onClick={clearUrgent} disabled={saving === 'clear'}>Clear now</button>}
        </div>
      </Card>
    </div>
  );
}

// ── Gmail ───────────────────────────────────────────────────────────────────
function GmailSection() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['gmail-status'], queryFn: gmailStatus });
  const [busy, setBusy] = useState(null);
  const connected = !!data?.connected;

  async function syncNow() { setBusy('sync'); try { await gmailSyncNow(); await qc.invalidateQueries({ queryKey: ['gmail-status'] }); } catch { /* noop */ } finally { setBusy(null); } }
  async function disconnect() { setBusy('disc'); try { await gmailDisconnect(); await qc.invalidateQueries({ queryKey: ['gmail-status'] }); } catch { /* noop */ } finally { setBusy(null); } }

  return (
    <Card style={{ maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Mail size={17} color={ACCENT} /><span style={{ fontSize: 15, fontWeight: 800, color: HEADER }}>Gmail inbox</span>
      </div>
      <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 16 }}>Read-only sync that turns inbound customer emails into Queries (auto-triaged). Never sends or alters mail.</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: '#F8FAFC', borderRadius: 10, marginBottom: 16 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: connected ? GREEN : '#CBD5E1' }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: TITLE }}>{connected ? `Connected · ${data.email_address}` : 'Not connected'}</div>
          {connected && data.last_sync_at && <div style={{ fontSize: 12, color: MUTED }}>Last synced {new Date(data.last_sync_at).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })} · auto every 3 min</div>}
        </div>
      </div>

      {connected ? (
        <div style={{ display: 'flex', gap: 10 }}>
          <button style={btn(ACCENT, busy === 'sync')} disabled={busy === 'sync'} onClick={syncNow}>
            <RefreshCw size={15} style={{ animation: busy === 'sync' ? 'spin 1s linear infinite' : 'none' }} /> {busy === 'sync' ? 'Syncing…' : 'Sync now'}
          </button>
          <button style={ghostBtn} disabled={busy === 'disc'} onClick={disconnect}>Disconnect</button>
        </div>
      ) : (
        <>
          <button style={btn(ACCENT)} onClick={() => { window.location.href = gmailConnectUrl(); }}>
            <Plug size={15} /> Connect Gmail
          </button>
          <div style={{ fontSize: 11.5, color: '#94A3B8', marginTop: 10 }}>Requires GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REDIRECT_URI to be set on the server.</div>
        </>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Card>
  );
}

// ── Xero ────────────────────────────────────────────────────────────────────
function XeroLinkRow({ c, suggestion, onChanged }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);

  async function doSearch() { if (q.trim().length < 2) return; setBusy(true); try { const d = await xeroContactSearch(q.trim()); setResults(d.contacts || []); } finally { setBusy(false); } }
  async function link(xc) { setBusy(true); try { await xeroLinkCustomer(c.id, xc.id || xc.xero_id, xc.name || xc.xero_name); setOpen(false); await onChanged(); } finally { setBusy(false); } }
  async function unlink() { setBusy(true); try { await xeroUnlinkCustomer(c.id); await onChanged(); } finally { setBusy(false); } }

  return (
    <>
      <tr style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
        <td style={{ padding: '8px 6px', fontWeight: 600, color: TITLE }}>{c.business_name}</td>
        <td style={{ padding: '8px 6px' }}>
          {c.xero_contact_id ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: '#047857' }}>
              <Check size={13} /> {c.xero_contact_name || 'Linked'}
            </span>
          ) : suggestion ? (
            <span style={{ fontSize: 12.5, color: MUTED }}>Suggested: <strong style={{ color: TITLE }}>{suggestion.xero_name}</strong> <span style={{ color: '#94A3B8' }}>({suggestion.score}%)</span></span>
          ) : <span style={{ fontSize: 12.5, color: '#CBD5E1' }}>—</span>}
        </td>
        <td style={{ padding: '8px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
          {c.xero_contact_id ? (
            <button onClick={unlink} disabled={busy} style={ghostBtn}>Unlink</button>
          ) : (
            <span style={{ display: 'inline-flex', gap: 6 }}>
              {suggestion && <button onClick={() => link(suggestion)} disabled={busy} style={btn(ACCENT, busy)}><Link2 size={13} /> Link</button>}
              <button onClick={() => setOpen(o => !o)} disabled={busy} style={ghostBtn}><Search size={13} /> Find</button>
            </span>
          )}
        </td>
      </tr>
      {open && (
        <tr><td colSpan={3} style={{ padding: '4px 6px 12px', background: '#F8FAFC' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch()} placeholder="Search Xero contacts…" style={{ ...inputStyle, flex: '0 0 280px' }} />
            <button onClick={doSearch} disabled={busy} style={btn(ACCENT, busy)}><Search size={13} /> {busy ? '…' : 'Search'}</button>
          </div>
          {results.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', fontSize: 12.5 }}>
              <span style={{ color: TITLE }}>{r.name}{r.email ? <span style={{ color: '#94A3B8' }}> · {r.email}</span> : ''}</span>
              <button onClick={() => link(r)} disabled={busy} style={btn(ACCENT, busy)}><Link2 size={13} /> Link</button>
            </div>
          ))}
          {!results.length && <div style={{ fontSize: 12, color: '#94A3B8', padding: '4px 10px' }}>Type a name and search.</div>}
        </td></tr>
      )}
    </>
  );
}

function XeroSection() {
  const qc = useQueryClient();
  const { data: status } = useQuery({ queryKey: ['xero-status'], queryFn: xeroStatus });
  const { data: match } = useQuery({ queryKey: ['xero-match'], queryFn: xeroMatchStatus, enabled: !!status?.connected });
  const [busy, setBusy] = useState(null);
  const [autoResult, setAutoResult] = useState(null);
  const connected = !!status?.connected;
  const configured = status?.configured !== false;

  const refresh = () => { qc.invalidateQueries({ queryKey: ['xero-status'] }); qc.invalidateQueries({ queryKey: ['xero-match'] }); };
  async function disconnect() { setBusy('disc'); try { await xeroDisconnect(); await refresh(); } finally { setBusy(null); } }
  async function autoMatch() { setBusy('auto'); setAutoResult(null); try { const d = await xeroAutoMatch(); setAutoResult(d); await qc.invalidateQueries({ queryKey: ['xero-match'] }); } finally { setBusy(null); } }

  const customers = match?.customers || [];
  const linkedCount = customers.filter(c => c.xero_contact_id).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 760 }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Banknote size={17} color={ACCENT} /><span style={{ fontSize: 15, fontWeight: 800, color: HEADER }}>Xero accounting</span>
        </div>
        <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 16 }}>Connect your Xero organisation to show live invoices and outstanding balances on each customer record.</div>
        {!configured && <div style={{ fontSize: 12.5, color: '#92400E', background: '#FFFBEB', borderRadius: 9, padding: '9px 12px', marginBottom: 14 }}>Set XERO_CLIENT_ID, XERO_CLIENT_SECRET and XERO_REDIRECT_URI on the server first.</div>}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: '#F8FAFC', borderRadius: 10, marginBottom: 16 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: connected ? GREEN : '#CBD5E1' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: TITLE }}>{connected ? `Connected · ${status.tenant_name || 'Xero org'}` : 'Not connected'}</div>
            {connected && linkedCount > 0 && <div style={{ fontSize: 12, color: MUTED }}>{linkedCount} of {customers.length} customers linked</div>}
          </div>
        </div>

        {connected ? (
          <div style={{ display: 'flex', gap: 10 }}>
            <button style={btn(ACCENT, busy === 'auto')} disabled={busy === 'auto'} onClick={autoMatch}><Wand2 size={15} /> {busy === 'auto' ? 'Matching…' : 'Auto-match customers'}</button>
            <button style={ghostBtn} disabled={busy === 'disc'} onClick={disconnect}>Disconnect</button>
          </div>
        ) : (
          <button style={btn(ACCENT, !configured)} disabled={!configured} onClick={() => { window.location.href = xeroConnectUrl(); }}><Plug size={15} /> Connect Xero</button>
        )}
        {autoResult && <div style={{ fontSize: 12.5, color: '#065F46', background: '#ECFDF5', borderRadius: 9, padding: '9px 12px', marginTop: 12 }}>Auto-matched {autoResult.matched?.length || 0} · {autoResult.suggestions?.length || 0} more suggested (review below).</div>}
      </Card>

      {connected && (
        <Card>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: TITLE, marginBottom: 4 }}>Customer ↔ Xero contact links</div>
          <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 12 }}>Link each customer to its Xero contact so their invoices show on the customer record.</div>
          <div style={{ maxHeight: 460, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr style={{ color: '#94A3B8', textAlign: 'left', fontSize: 11.5, position: 'sticky', top: 0, background: '#fff' }}>
                <th style={{ padding: '7px 6px' }}>Customer</th><th style={{ padding: '7px 6px' }}>Xero contact</th><th style={{ padding: '7px 6px', textAlign: 'right' }}></th>
              </tr></thead>
              <tbody>
                {customers.map(c => <XeroLinkRow key={c.id} c={c} suggestion={match?.suggestions?.[c.id]} onChanged={() => qc.invalidateQueries({ queryKey: ['xero-match'] })} />)}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function ComingSoon({ Icon, title, note }) {
  return (
    <Card style={{ maxWidth: 640, borderStyle: 'dashed', border: '1.5px dashed #E2E8F0', boxShadow: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Icon size={17} color={AMBER} /><span style={{ fontSize: 15, fontWeight: 800, color: HEADER }}>{title}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#92400E', background: '#FEF3C7', borderRadius: 6, padding: '2px 7px' }}>Coming next</span>
      </div>
      <div style={{ fontSize: 12.5, color: MUTED }}>{note}</div>
    </Card>
  );
}

const TABS = [
  { key: 'board',   label: 'Warehouse board', Icon: Tv },
  { key: 'gmail',   label: 'Gmail',           Icon: Mail },
  { key: 'comms',   label: 'Communications',  Icon: MessageSquare },
  { key: 'xero',    label: 'Xero',            Icon: Banknote },
];

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(t => t.key === params.get('tab')) ? params.get('tab') : 'board';
  const setTab = (key) => setParams(key === 'board' ? {} : { tab: key }, { replace: true });
  const justConnected = params.get('connected') === '1';

  return (
    <div style={{ width: '100%', maxWidth: 'none' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: HEADER, margin: '0 0 4px', letterSpacing: -0.6, display: 'flex', alignItems: 'center', gap: 9 }}>
          <Settings size={22} /> Settings
        </h1>
        <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>Integrations and what shows on the warehouse TVs.</p>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap', borderBottom: '1px solid #E2E8F0', paddingBottom: 2 }}>
        {TABS.map(t => {
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', background: 'none', cursor: 'pointer',
              padding: '9px 13px', fontSize: 13.5, fontWeight: 700, color: active ? ACCENT : MUTED,
              borderBottom: active ? `2px solid ${ACCENT}` : '2px solid transparent', marginBottom: -3,
            }}>
              <t.Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {justConnected && tab === 'gmail' && (
        <div style={{ fontSize: 13, fontWeight: 700, color: '#065F46', background: '#ECFDF5', borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>✓ Gmail connected.</div>
      )}

      {tab === 'board' && <BoardSection />}
      {tab === 'gmail' && <GmailSection />}
      {tab === 'comms' && <ComingSoon Icon={MessageSquare} title="Communications & alerts" note="Email provider config plus alert types and recipients (e.g. webhook-gap, backfill, billing-run) — porting from Moov OS next." />}
      {tab === 'xero' && <XeroSection />}
    </div>
  );
}
