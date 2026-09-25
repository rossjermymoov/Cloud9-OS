import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Settings, Tv, Mail, MessageSquare, Banknote, Check, RefreshCw, Megaphone, UserPlus,
  Plug, Link2, Search, Wand2, Copy, ExternalLink, Palette, ShieldCheck, CheckCircle2,
  AlertCircle, Eye, EyeOff
} from 'lucide-react';
import {
  getBoardMessages, saveBoardWelcome, saveBoardUrgent, clearBoardUrgent,
  gmailStatus, gmailSyncNow, gmailDisconnect, gmailConnectUrl,
  getBranding, saveBranding, getHelmIntegration, saveHelmIntegration, testHelmConnection
} from '../../api/settings';
import {
  xeroStatus, xeroDisconnect, xeroConnectUrl, xeroContactSearch,
  xeroMatchStatus, xeroLinkCustomer, xeroUnlinkCustomer, xeroAutoMatch,
} from '../../api/xero';
import { useBranding } from '../../context/BrandingContext';

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
  const [copied, setCopied] = useState(false);
  const copyUrl = () => { if (data?.board_url) { navigator.clipboard?.writeText(data.board_url); setCopied(true); setTimeout(() => setCopied(false), 2000); } };

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Shareable TV-board URL */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Tv size={17} color={ACCENT} /><span style={{ fontSize: 15, fontWeight: 800, color: HEADER }}>Warehouse board link</span>
        </div>
        <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 12 }}>Open this on the warehouse TVs. It’s public (no login){data?.board_locked ? ' — the access key is already included below' : ''}.</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input readOnly value={data?.board_url || ''} onFocus={e => e.target.select()}
            style={{ ...inputStyle, flex: '1 1 380px', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5, color: TITLE }} />
          <button onClick={copyUrl} style={btn(ACCENT)}><Copy size={14} /> {copied ? 'Copied!' : 'Copy'}</button>
          <a href={data?.board_url || '#'} target="_blank" rel="noopener noreferrer" style={{ ...ghostBtn, textDecoration: 'none' }}><ExternalLink size={14} /> Open</a>
        </div>
      </Card>

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

// ── Branding & White-Labeling ───────────────────────────────────────────────
function BrandingSection() {
  const { appName, companyName, logoUrl, primaryColor, refreshBranding } = useBranding();
  const [formAppName, setFormAppName] = useState(appName);
  const [formCompanyName, setFormCompanyName] = useState(companyName);
  const [formColor, setFormColor] = useState(primaryColor || '#0056FB');
  const [formLogo, setFormLogo] = useState(logoUrl || '');
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);

  useEffect(() => {
    setFormAppName(appName);
    setFormCompanyName(companyName);
    setFormColor(primaryColor || '#0056FB');
    setFormLogo(logoUrl || '');
  }, [appName, companyName, primaryColor, logoUrl]);

  const initials = formAppName
    ? formAppName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : 'OS';

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setStatusMsg(null);
    try {
      await saveBranding({
        app_name: formAppName.trim() || 'Warehouse OS',
        company_name: formCompanyName.trim(),
        primary_color: formColor,
        logo_url: formLogo.trim(),
      });
      await refreshBranding();
      setStatusMsg({ ok: true, text: 'Branding settings saved successfully!' });
    } catch (err) {
      setStatusMsg({ ok: false, text: err?.response?.data?.error || err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Palette size={18} color={ACCENT} />
          <span style={{ fontSize: 16, fontWeight: 800, color: HEADER }}>Warehouse Branding & Identity</span>
        </div>
        <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 16 }}>
          White-label the system with your company name, top-left logo, and accent colour.
        </div>

        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>App Display Name</label>
            <input
              value={formAppName}
              onChange={e => setFormAppName(e.target.value)}
              placeholder="e.g. Apex Fulfilment OS"
              style={inputStyle}
              required
            />
            <div style={{ fontSize: 11.5, color: MUTED, marginTop: 4 }}>
              Appears in top-left sidebar, login screen, and browser tab.
            </div>
          </div>

          <div>
            <label style={labelStyle}>Company / Warehouse Entity Name</label>
            <input
              value={formCompanyName}
              onChange={e => setFormCompanyName(e.target.value)}
              placeholder="e.g. Apex Logistics Ltd"
              style={inputStyle}
            />
            <div style={{ fontSize: 11.5, color: MUTED, marginTop: 4 }}>
              Used in reports, TV board welcome slides, and courier manifests.
            </div>
          </div>

          <div>
            <label style={labelStyle}>Brand Accent Colour</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="color"
                value={formColor}
                onChange={e => setFormColor(e.target.value)}
                style={{ width: 42, height: 38, border: '1px solid #E2E8F0', borderRadius: 8, cursor: 'pointer', padding: 2 }}
              />
              <input
                value={formColor}
                onChange={e => setFormColor(e.target.value)}
                placeholder="#0056FB"
                style={{ ...inputStyle, flex: 1, fontFamily: 'ui-monospace, monospace' }}
              />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Custom Logo Image URL (Optional)</label>
            <input
              value={formLogo}
              onChange={e => setFormLogo(e.target.value)}
              placeholder="https://example.com/logo.png"
              style={inputStyle}
            />
          </div>

          {statusMsg && (
            <div style={{
              padding: '8px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
              background: statusMsg.ok ? '#ECFDF5' : '#FEF2F2',
              color: statusMsg.ok ? '#065F46' : RED,
              border: `1px solid ${statusMsg.ok ? '#A7F3D0' : '#FECACA'}`
            }}>
              {statusMsg.text}
            </div>
          )}

          <div style={{ paddingTop: 4 }}>
            <button type="submit" disabled={saving} style={btn(ACCENT, saving)}>
              {saving ? <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={14} />}
              {saving ? 'Saving…' : 'Save Branding'}
            </button>
          </div>
        </form>
      </Card>

      {/* Live Preview Card */}
      <Card style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: TITLE, marginBottom: 12 }}>
          Live Sidebar Preview
        </div>
        <div style={{
          background: '#0E131F', color: '#fff', borderRadius: 12, padding: '16px 18px',
          display: 'flex', alignItems: 'center', gap: 12, maxWidth: 280
        }}>
          {formLogo ? (
            <img src={formLogo} alt={formAppName} style={{ width: 34, height: 34, borderRadius: 9, objectFit: 'contain' }} />
          ) : (
            <div style={{
              width: 34, height: 34, borderRadius: 9,
              background: `linear-gradient(135deg, ${formColor || '#0056FB'} 0%, #7B2FBE 100%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, fontSize: 14, color: '#fff'
            }}>{initials}</div>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 800, letterSpacing: -0.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {formAppName || 'Warehouse OS'}
            </div>
            <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', fontWeight: 500 }}>
              3PL Operations Suite
            </div>
          </div>
        </div>

        <div style={{ marginTop: 24, fontSize: 12, color: MUTED, lineHeight: 1.5 }}>
          Changing these values updates the software identity across all user workstations and TV boards immediately.
        </div>
      </Card>
    </div>
  );
}

// ── Helm WMS Integration ────────────────────────────────────────────────────
function HelmIntegrationSection() {
  const qc = useQueryClient();
  const { data: status, isLoading } = useQuery({ queryKey: ['helm-integration-status'], queryFn: getHelmIntegration });
  const [baseUrl, setBaseUrl] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [twoFa, setTwoFa] = useState('');
  const [showPw, setShowPw] = useState(false);

  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    if (status) {
      setBaseUrl(status.base_url || '');
      setEmail(status.source === 'database' ? '' : '');
    }
  }, [status]);

  async function handleTest() {
    setTesting(true);
    setFeedback(null);
    try {
      const res = await testHelmConnection({
        base_url: baseUrl.trim(),
        email: email.trim(),
        password,
        two_fa_code: twoFa.trim(),
      });
      setFeedback({ ok: true, text: res.message || 'Connection test successful! Valid Bearer token received from Helm.' });
    } catch (err) {
      setFeedback({ ok: false, text: err?.response?.data?.error || err.message });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      await saveHelmIntegration({
        base_url: baseUrl.trim(),
        email: email.trim(),
        password,
        two_fa_code: twoFa.trim(),
      });
      await qc.invalidateQueries({ queryKey: ['helm-integration-status'] });
      setPassword('');
      setFeedback({ ok: true, text: 'Helm credentials saved and verified!' });
    } catch (err) {
      setFeedback({ ok: false, text: err?.response?.data?.error || err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card style={{ maxWidth: 680 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Plug size={18} color={ACCENT} />
          <span style={{ fontSize: 16, fontWeight: 800, color: HEADER }}>Helm WMS API Connection</span>
        </div>
        {status?.configured ? (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#ECFDF5', color: '#065F46', border: '1px solid #A7F3D0', padding: '3px 9px', borderRadius: 16, fontSize: 11.5, fontWeight: 700 }}>
            <CheckCircle2 size={13} /> Connected to Helm
          </div>
        ) : (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#FEF2F2', color: RED, border: '1px solid #FECACA', padding: '3px 9px', borderRadius: 16, fontSize: 11.5, fontWeight: 700 }}>
            <AlertCircle size={13} /> Not Configured
          </div>
        )}
      </div>

      <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 18 }}>
        Connect this instance to your Helm Warehouse Management System. The OS uses this connection to pull inventory, sync stock, and register scale measurements.
      </div>

      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle}>Helm Public API Base URL</label>
          <input
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder="https://yourcompany.myhelm.app/public-api"
            style={{ ...inputStyle, fontFamily: 'ui-monospace, monospace' }}
            required
          />
          <div style={{ fontSize: 11.5, color: MUTED, marginTop: 4 }}>
            The public API endpoint for your Helm tenant.
          </div>
        </div>

        <div>
          <label style={labelStyle}>Helm Admin Login Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder={status?.email || 'admin@yourcompany.com'}
            style={inputStyle}
            required={!status?.has_password}
          />
          {status?.email && (
            <div style={{ fontSize: 11.5, color: MUTED, marginTop: 4 }}>
              Currently configured: <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600 }}>{status.email}</span> (leave blank to keep current)
            </div>
          )}
        </div>

        <div>
          <label style={labelStyle}>Helm Password</label>
          <div style={{ position: 'relative' }}>
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={status?.has_password ? '•••••••••••• (leave blank to keep unchanged)' : 'Enter your Helm password'}
              style={{ ...inputStyle, paddingRight: 40 }}
              required={!status?.has_password}
            />
            <button
              type="button"
              onClick={() => setShowPw(!showPw)}
              style={{ position: 'absolute', right: 10, top: 10, border: 'none', background: 'none', cursor: 'pointer', color: MUTED }}
            >
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <div>
          <label style={labelStyle}>2FA Code (Optional)</label>
          <input
            value={twoFa}
            onChange={e => setTwoFa(e.target.value)}
            placeholder="Leave blank unless 2FA is required on login"
            style={inputStyle}
          />
        </div>

        {feedback && (
          <div style={{
            padding: '10px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
            background: feedback.ok ? '#ECFDF5' : '#FEF2F2',
            color: feedback.ok ? '#065F46' : RED,
            border: `1px solid ${feedback.ok ? '#A7F3D0' : '#FECACA'}`
          }}>
            {feedback.text}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', paddingTop: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !baseUrl || !email || (!password && !status?.has_password)}
            style={ghostBtn}
          >
            {testing ? <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <ShieldCheck size={14} color={ACCENT} />}
            {testing ? 'Testing Connection…' : 'Test Handshake'}
          </button>

          <button type="submit" disabled={saving || !baseUrl} style={btn(ACCENT, saving)}>
            {saving ? <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={14} />}
            {saving ? 'Verifying & Saving…' : 'Save & Connect to Helm'}
          </button>
        </div>
      </form>
    </Card>
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
  { key: 'branding', label: 'Branding & Identity', Icon: Palette },
  { key: 'helm',     label: 'Helm WMS',            Icon: Plug },
  { key: 'board',    label: 'Warehouse board',     Icon: Tv },
  { key: 'gmail',    label: 'Gmail',               Icon: Mail },
  { key: 'comms',    label: 'Communications',      Icon: MessageSquare },
  { key: 'xero',     label: 'Xero',                Icon: Banknote },
];

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(t => t.key === params.get('tab')) ? params.get('tab') : 'branding';
  const setTab = (key) => setParams(key === 'branding' ? {} : { tab: key }, { replace: true });
  const justConnected = params.get('connected') === '1';

  return (
    <div style={{ width: '100%', maxWidth: 'none' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: HEADER, margin: '0 0 4px', letterSpacing: -0.6, display: 'flex', alignItems: 'center', gap: 9 }}>
          <Settings size={22} /> Settings
        </h1>
        <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>White-labeling, Helm WMS connection, and warehouse TV boards.</p>
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

      {tab === 'branding' && <BrandingSection />}
      {tab === 'helm' && <HelmIntegrationSection />}
      {tab === 'board' && <BoardSection />}
      {tab === 'gmail' && <GmailSection />}
      {tab === 'comms' && <ComingSoon Icon={MessageSquare} title="Communications & alerts" note="Email provider config plus alert types and recipients (e.g. webhook-gap, backfill, billing-run) — porting from Moov OS next." />}
      {tab === 'xero' && <XeroSection />}
    </div>
  );
}
