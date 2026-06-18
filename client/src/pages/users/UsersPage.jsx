import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserCog, UserPlus, X, KeyRound, Ban, CheckCircle2 } from 'lucide-react';
import { listUsers, createUser, updateUser, deactivateUser } from '../../api/users';
import { useAuth } from '../../context/AuthContext';

const HEADER = '#0B1220', TITLE = '#0F172A', MUTED = '#64748B', ACCENT = '#0056FB', GREEN = '#10B981', RED = '#E11D48';
const SHADOW = '0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.10)';
const input = { width: '100%', boxSizing: 'border-box', border: '1px solid #E2E8F0', borderRadius: 9, padding: '10px 12px', fontSize: 13.5, fontFamily: 'inherit', marginBottom: 10 };

function InviteDrawer({ onClose }) {
  const qc = useQueryClient();
  const [full_name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setErr(null);
    if (password.length < 8) { setErr('Password must be at least 8 characters'); return; }
    setBusy(true);
    try { await createUser({ full_name, email, password }); await qc.invalidateQueries({ queryKey: ['app-users'] }); onClose(); }
    catch (e) { setErr(e?.response?.data?.error || 'Could not create user'); setBusy(false); }
  }
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 100 }}>
      <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 0, right: 0, height: '100%', width: 420, maxWidth: '94vw', background: '#fff', boxShadow: '-8px 0 24px rgba(0,0,0,0.12)', padding: 24, overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: TITLE }}>Invite a user</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED }}><X size={18} /></button>
        </div>
        <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 18 }}>Set their email and a starting password — they can change it after signing in. Everyone has full access for now.</div>
        <form onSubmit={submit}>
          {err && <div style={{ background: '#FEF2F2', color: '#B91C1C', fontSize: 12.5, borderRadius: 8, padding: '9px 11px', marginBottom: 12 }}>{err}</div>}
          <input style={input} placeholder="Full name" value={full_name} onChange={e => setName(e.target.value)} autoFocus />
          <input style={input} type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
          <input style={input} type="text" placeholder="Starting password (min 8 chars)" value={password} onChange={e => setPassword(e.target.value)} required />
          <button type="submit" disabled={busy} style={{ width: '100%', border: 'none', background: ACCENT, color: '#fff', borderRadius: 10, padding: 12, fontSize: 14, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Creating…' : 'Create user'}</button>
        </form>
      </div>
    </div>
  );
}

export default function UsersPage() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [invite, setInvite] = useState(false);
  const { data: users } = useQuery({ queryKey: ['app-users'], queryFn: listUsers });

  async function resetPassword(u) {
    const pw = window.prompt(`New password for ${u.full_name || u.email} (min 8 characters):`);
    if (!pw) return;
    if (pw.length < 8) { window.alert('Password must be at least 8 characters'); return; }
    try { await updateUser(u.id, { password: pw }); window.alert('Password updated.'); }
    catch (e) { window.alert(e?.response?.data?.error || 'Could not update password'); }
  }
  async function toggleActive(u) {
    try {
      if (u.active) { await deactivateUser(u.id); } else { await updateUser(u.id, { active: true }); }
      qc.invalidateQueries({ queryKey: ['app-users'] });
    } catch (e) { window.alert(e?.response?.data?.error || 'Could not update user'); }
  }

  return (
    <div style={{ width: '100%', maxWidth: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: HEADER, margin: '0 0 4px', letterSpacing: -0.6, display: 'flex', alignItems: 'center', gap: 9 }}>
            <UserCog size={22} /> Users
          </h1>
          <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>People who can sign in to Cloud9 OS. Everyone has full access for now.</p>
        </div>
        <button onClick={() => setInvite(true)} style={{ display: 'flex', alignItems: 'center', gap: 7, border: 'none', background: ACCENT, color: '#fff', borderRadius: 9, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          <UserPlus size={15} /> Invite user
        </button>
      </div>

      <div style={{ background: '#fff', borderRadius: 14, boxShadow: SHADOW, padding: 6 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ color: '#94A3B8', textAlign: 'left', fontSize: 11.5 }}>
            <th style={{ padding: '10px 12px' }}>Name</th><th style={{ padding: '10px 12px' }}>Email</th>
            <th style={{ padding: '10px 12px' }}>Status</th><th style={{ padding: '10px 12px' }}>Last sign-in</th>
            <th style={{ padding: '10px 12px', textAlign: 'right' }}>Actions</th>
          </tr></thead>
          <tbody>
            {(users || []).map(u => (
              <tr key={u.id} style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                <td style={{ padding: '11px 12px', fontWeight: 600, color: TITLE }}>{u.full_name || '—'}{me && u.id === me.id && <span style={{ color: '#94A3B8', fontWeight: 500 }}> (you)</span>}</td>
                <td style={{ padding: '11px 12px', color: MUTED }}>{u.email}</td>
                <td style={{ padding: '11px 12px' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 600, color: u.active ? GREEN : RED }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: u.active ? GREEN : RED }} />{u.active ? 'Active' : 'Disabled'}</span>
                </td>
                <td style={{ padding: '11px 12px', color: MUTED }}>{u.last_login_at ? new Date(u.last_login_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never'}</td>
                <td style={{ padding: '11px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => resetPassword(u)} title="Reset password" style={iconBtn}><KeyRound size={14} /></button>
                  <button onClick={() => toggleActive(u)} title={u.active ? 'Disable' : 'Enable'} style={{ ...iconBtn, color: u.active ? RED : GREEN }}>
                    {u.active ? <Ban size={14} /> : <CheckCircle2 size={14} />}
                  </button>
                </td>
              </tr>
            ))}
            {(!users?.length) && <tr><td colSpan={5} style={{ padding: 20, textAlign: 'center', color: '#94A3B8' }}>No users yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {invite && <InviteDrawer onClose={() => setInvite(false)} />}
    </div>
  );
}

const iconBtn = { border: '1px solid #E2E8F0', background: '#fff', borderRadius: 8, padding: '6px 8px', cursor: 'pointer', color: MUTED, marginLeft: 6 };
