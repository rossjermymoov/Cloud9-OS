import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';

const ACCENT = '#0056FB', TITLE = '#0F172A', MUTED = '#64748B';

function Shell({ title, subtitle, children }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0B1220', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 400, background: '#fff', borderRadius: 16, padding: 32, boxShadow: '0 12px 40px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg,#00BCD4,#7B2FBE)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 15 }}>C9</div>
          <span style={{ fontSize: 17, fontWeight: 800, color: TITLE }}>Cloud9 OS</span>
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: TITLE, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 13, color: MUTED, marginBottom: 22 }}>{subtitle}</div>
        {children}
      </div>
    </div>
  );
}
const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #E2E8F0', borderRadius: 9, padding: '11px 12px', fontSize: 14, fontFamily: 'inherit', marginBottom: 12 };
const btnStyle = (busy) => ({ width: '100%', border: 'none', background: ACCENT, color: '#fff', borderRadius: 10, padding: '12px', fontSize: 14, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 });
const Field = (p) => <input {...p} style={inputStyle} />;
const Err = ({ children }) => children ? <div style={{ background: '#FEF2F2', color: '#B91C1C', fontSize: 12.5, borderRadius: 8, padding: '9px 11px', marginBottom: 12 }}>{children}</div> : null;

export function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await login(email, password); } catch (e) { setErr(e.message); setBusy(false); }
  }
  return (
    <Shell title="Sign in" subtitle="Welcome back. Enter your details to continue.">
      <form onSubmit={submit}>
        <Err>{err}</Err>
        <Field type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} autoFocus required />
        <Field type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required />
        <button type="submit" disabled={busy} style={btnStyle(busy)}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </Shell>
  );
}

export function SetupScreen() {
  const { setupAdmin } = useAuth();
  const [full_name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setErr(null);
    if (password.length < 8) { setErr('Password must be at least 8 characters'); return; }
    setBusy(true);
    try { await setupAdmin(full_name, email, password); } catch (e) { setErr(e.message); setBusy(false); }
  }
  return (
    <Shell title="Create your admin account" subtitle="This is the first account for Cloud9 OS. You can invite your team afterwards.">
      <form onSubmit={submit}>
        <Err>{err}</Err>
        <Field type="text" placeholder="Full name" value={full_name} onChange={e => setName(e.target.value)} autoFocus />
        <Field type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
        <Field type="password" placeholder="Password (min 8 characters)" value={password} onChange={e => setPassword(e.target.value)} required />
        <button type="submit" disabled={busy} style={btnStyle(busy)}>{busy ? 'Creating…' : 'Create account & continue'}</button>
      </form>
    </Shell>
  );
}

export function AuthLoading() {
  return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0B1220', color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>Loading…</div>;
}
