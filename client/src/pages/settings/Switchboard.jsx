/**
 * Switchboard — /settings/switchboard
 *
 * SLA response thresholds + the Probation → Autopilot calibration board. The
 * manager sets per-scope SLA windows and promotes workflow categories
 * (courier + intent) to Full Autopilot once they reach 20 clean approvals.
 */
import { useState, useEffect } from 'react';
import axios from 'axios';
import { SettingsNav } from './RulesSettings';

const api = axios.create({ baseURL: '/api' });
const inputSt = { width: 80, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 7, padding: '6px 9px', fontSize: 13, outline: 'none' };

export default function Switchboard() {
  const [sla, setSla]       = useState([]);
  const [trust, setTrust]   = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => Promise.all([
    api.get('/settings/sla-configs').then(r => setSla(r.data || [])).catch(() => setSla([])),
    api.get('/settings/workflow-trust').then(r => setTrust(r.data || [])).catch(() => setTrust([])),
  ]).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const setSlaField = (group, k, v) => setSla(list => list.map(s => s.workflow_group === group ? { ...s, [k]: v } : s));
  async function saveSla(s) {
    try {
      await api.put(`/settings/sla-configs/${s.workflow_group}`, {
        response_target_minutes: parseInt(s.response_target_minutes) || 0,
        warning_buffer_minutes:  parseInt(s.warning_buffer_minutes) || 0,
        scream_to_google_chat:   !!s.scream_to_google_chat,
      });
    } catch (e) { alert('Save failed: ' + (e.response?.data?.error || e.message)); }
  }

  async function toggleAutopilot(w) {
    try {
      const r = await api.put(`/settings/workflow-trust/${w.courier_code}/${w.intent}/toggle`, { enabled: !w.autopilot_enabled });
      setTrust(list => list.map(x => (x.courier_code === w.courier_code && x.intent === w.intent) ? { ...x, ...r.data } : x));
    } catch (e) { alert(e.response?.data?.error || e.message); }
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <SettingsNav />

      <h2 style={{ fontSize: 19, fontWeight: 800, color: '#0F172A', margin: '0 0 4px' }}>⏱️ SLA &amp; Autopilot Switchboard</h2>
      <p style={{ fontSize: 12.5, color: '#64748B', marginTop: 0, marginBottom: 22, maxWidth: 640, lineHeight: 1.5 }}>
        Set response-time thresholds, and promote calibrated workflows from Probation to Full Autopilot.
      </p>

      {loading && <div style={{ padding: 28, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>Loading…</div>}

      {!loading && (
        <>
          {/* SLA thresholds */}
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94A3B8', marginBottom: 10 }}>SLA Response Thresholds</div>
          <div className="moov-card" style={{ overflow: 'hidden', marginBottom: 36 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#64748B', fontSize: 11 }}>
                  <th style={{ padding: '10px 14px' }}>Scope</th>
                  <th style={{ padding: '10px 14px' }}>Response (min)</th>
                  <th style={{ padding: '10px 14px' }}>Warning buffer (min)</th>
                  <th style={{ padding: '10px 14px' }}>Scream → Google Chat</th>
                  <th style={{ padding: '10px 14px' }}></th>
                </tr>
              </thead>
              <tbody>
                {sla.map(s => (
                  <tr key={s.workflow_group} style={{ borderTop: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '8px 14px', fontWeight: 600, color: '#0F172A', textTransform: 'capitalize' }}>{s.workflow_group.replace(/_/g, ' ')}</td>
                    <td style={{ padding: '8px 14px' }}><input type="number" value={s.response_target_minutes} onChange={e => setSlaField(s.workflow_group, 'response_target_minutes', e.target.value)} style={inputSt} /></td>
                    <td style={{ padding: '8px 14px' }}><input type="number" value={s.warning_buffer_minutes} onChange={e => setSlaField(s.workflow_group, 'warning_buffer_minutes', e.target.value)} style={inputSt} /></td>
                    <td style={{ padding: '8px 14px' }}>
                      <input type="checkbox" checked={!!s.scream_to_google_chat} onChange={e => setSlaField(s.workflow_group, 'scream_to_google_chat', e.target.checked)} />
                    </td>
                    <td style={{ padding: '8px 14px', textAlign: 'right' }}><button className="btn-primary" onClick={() => saveSla(s)}>Save</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Autopilot calibration */}
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94A3B8', marginBottom: 10 }}>🤖 Autopilot Workflows (Probation → Autopilot)</div>
          {trust.length === 0 && (
            <div className="moov-card" style={{ padding: 24, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>
              No workflow categories tracked yet — they appear here as drafts get approved.
            </div>
          )}
          {trust.map(w => {
            const pct = Math.min(100, Math.round((w.consecutive_clean_approvals / (w.cap || 20)) * 100));
            return (
              <div key={`${w.courier_code}-${w.intent}`} className="moov-card" style={{ padding: '14px 18px', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', textTransform: 'capitalize' }}>
                      {(w.courier_code || 'unknown').toUpperCase()} · {String(w.intent || '').replace(/_/g, ' ')}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#64748B', marginTop: 2 }}>
                      {w.locked ? '⚠ Locked to Copilot — cannot run on Autopilot.'
                        : w.autopilot_enabled ? '🟢 Full Autopilot — dispatching autonomously.'
                        : w.ready ? '🎯 Automation Stable — ready to enable.'
                        : `Probation (Draft Mode) — ${w.consecutive_clean_approvals}/${w.cap} clean approvals.`}
                    </div>
                    {/* progress bar */}
                    <div style={{ marginTop: 8, height: 6, width: 240, background: '#F1F5F9', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: w.ready ? '#10B981' : '#6366F1' }} />
                    </div>
                  </div>
                  <button
                    onClick={() => toggleAutopilot(w)}
                    disabled={w.locked || (!w.autopilot_enabled && !w.ready)}
                    className={w.autopilot_enabled ? '' : 'btn-primary'}
                    style={{
                      flexShrink: 0, borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, cursor: (w.locked || (!w.autopilot_enabled && !w.ready)) ? 'not-allowed' : 'pointer',
                      border: w.autopilot_enabled ? '1px solid #FECACA' : undefined,
                      background: w.autopilot_enabled ? '#FEF2F2' : undefined,
                      color: w.autopilot_enabled ? '#B91C1C' : undefined,
                      opacity: (w.locked || (!w.autopilot_enabled && !w.ready)) ? 0.5 : 1,
                    }}>
                    {w.autopilot_enabled ? 'Turn OFF Autopilot' : 'Enable Full Autopilot'}
                  </button>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
