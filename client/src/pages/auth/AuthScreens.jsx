import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useBranding } from '../../context/BrandingContext';
import { testHelmConnection } from '../../api/settings';
import { Palette, Plug, UserPlus, ShieldCheck, Check, ArrowRight, ArrowLeft, RefreshCw } from 'lucide-react';

const ACCENT = '#0056FB', TITLE = '#0F172A', MUTED = '#64748B', GREEN = '#10B981', RED = '#EF4444';

function Shell({ title, subtitle, children, width = 400 }) {
  const { appName, primaryColor, logoUrl } = useBranding();
  const initials = appName
    ? appName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : 'OS';

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0B1220', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: width, background: '#fff', borderRadius: 16, padding: 32, boxShadow: '0 12px 40px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          {logoUrl ? (
            <img src={logoUrl} alt={appName} style={{ width: 34, height: 34, borderRadius: 9, objectFit: 'contain' }} />
          ) : (
            <div style={{
              width: 34, height: 34, borderRadius: 9,
              background: `linear-gradient(135deg, ${primaryColor || '#0056FB'}, #7B2FBE)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 800, fontSize: 14
            }}>{initials}</div>
          )}
          <span style={{ fontSize: 17, fontWeight: 800, color: TITLE }}>{appName || 'Warehouse OS'}</span>
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: TITLE, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 13, color: MUTED, marginBottom: 20, lineHeight: 1.4 }}>{subtitle}</div>
        {children}
      </div>
    </div>
  );
}

const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #E2E8F0', borderRadius: 9, padding: '10px 12px', fontSize: 13.5, fontFamily: 'inherit', marginBottom: 12 };
const btnStyle = (bg = ACCENT, busy = false) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
  border: 'none', background: bg, color: '#fff', borderRadius: 9, padding: '11px 16px',
  fontSize: 13.5, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, width: '100%'
});
const ghostBtn = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  border: '1px solid #E2E8F0', background: '#fff', color: TITLE, borderRadius: 9,
  padding: '10px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer'
};
const Field = ({ label, ...p }) => (
  <div>
    {label && <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: TITLE, marginBottom: 5 }}>{label}</label>}
    <input {...p} style={inputStyle} />
  </div>
);
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
    <Shell title="Sign in" subtitle="Welcome back. Enter your details to access the system.">
      <form onSubmit={submit}>
        <Err>{err}</Err>
        <Field type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} autoFocus required />
        <Field type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required />
        <button type="submit" disabled={busy} style={btnStyle(ACCENT, busy)}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </Shell>
  );
}

export function SetupScreen() {
  const { setupAdmin } = useAuth();
  const { refreshBranding } = useBranding();
  const [step, setStep] = useState(1); // 1: Branding, 2: Helm, 3: Admin User

  // Step 1: Branding
  const [appName, setAppName] = useState('Cloud9 OS');
  const [companyName, setCompanyName] = useState('Cloud9 Fulfillment');

  // Step 2: Helm
  const [helmUrl, setHelmUrl] = useState('');
  const [helmEmail, setHelmEmail] = useState('');
  const [helmPassword, setHelmPassword] = useState('');
  const [helm2fa, setHelm2fa] = useState('');
  const [helmTesting, setHelmTesting] = useState(false);
  const [helmFeedback, setHelmFeedback] = useState(null);

  // Step 3: Admin
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function testHelm() {
    setHelmTesting(true);
    setHelmFeedback(null);
    try {
      const res = await testHelmConnection({
        base_url: helmUrl.trim(),
        email: helmEmail.trim(),
        password: helmPassword,
        two_fa_code: helm2fa.trim(),
      });
      setHelmFeedback({ ok: true, text: res.message || '✓ Handshake succeeded! Valid token received from Helm.' });
    } catch (e) {
      setHelmFeedback({ ok: false, text: e?.response?.data?.error || e.message });
    } finally {
      setHelmTesting(false);
    }
  }

  async function finishSetup(e) {
    e.preventDefault();
    setErr(null);
    if (password.length < 8) {
      setErr('Password must be at least 8 characters');
      return;
    }
    setBusy(true);
    try {
      await setupAdmin({
        full_name: fullName,
        email,
        password,
        app_name: appName.trim() || 'Warehouse OS',
        company_name: companyName.trim(),
        helm_base_url: helmUrl.trim(),
        helm_email: helmEmail.trim(),
        helm_password: helmPassword,
        helm_2fa_code: helm2fa.trim(),
      });
      await refreshBranding();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <Shell
      title="Warehouse OS Setup Wizard"
      subtitle={`Step ${step} of 3 — ${step === 1 ? 'Configure your warehouse identity' : step === 2 ? 'Connect your Helm WMS API' : 'Create your initial administrator account'}`}
      width={460}
    >
      {/* Step Indicators */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {[1, 2, 3].map(s => (
          <div
            key={s}
            style={{
              flex: 1, height: 4, borderRadius: 2,
              background: s <= step ? ACCENT : '#E2E8F0',
              transition: 'background 0.2s ease'
            }}
          />
        ))}
      </div>

      <Err>{err}</Err>

      {/* ── STEP 1: Branding ── */}
      {step === 1 && (
        <div>
          <Field
            label="App Display Name"
            type="text"
            placeholder="e.g. Apex Fulfilment OS"
            value={appName}
            onChange={e => setAppName(e.target.value)}
            autoFocus
            required
          />
          <Field
            label="Company / Warehouse Name"
            type="text"
            placeholder="e.g. Apex Logistics Ltd"
            value={companyName}
            onChange={e => setCompanyName(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setStep(2)}
            style={btnStyle(ACCENT)}
          >
            Continue to Helm Connection <ArrowRight size={15} />
          </button>
        </div>
      )}

      {/* ── STEP 2: Helm Connection ── */}
      {step === 2 && (
        <div>
          <Field
            label="Helm Public API Base URL"
            type="text"
            placeholder="https://yourcompany.myhelm.app/public-api"
            value={helmUrl}
            onChange={e => setHelmUrl(e.target.value)}
            autoFocus
          />
          <Field
            label="Helm Admin Email"
            type="email"
            placeholder="admin@yourcompany.com"
            value={helmEmail}
            onChange={e => setHelmEmail(e.target.value)}
          />
          <Field
            label="Helm Admin Password"
            type="password"
            placeholder="••••••••••••"
            value={helmPassword}
            onChange={e => setHelmPassword(e.target.value)}
          />

          {helmFeedback && (
            <div style={{
              padding: '8px 11px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              background: helmFeedback.ok ? '#ECFDF5' : '#FEF2F2',
              color: helmFeedback.ok ? '#065F46' : RED,
              border: `1px solid ${helmFeedback.ok ? '#A7F3D0' : '#FECACA'}`,
              marginBottom: 12
            }}>
              {helmFeedback.text}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button
              type="button"
              onClick={testHelm}
              disabled={helmTesting || !helmUrl || !helmEmail || !helmPassword}
              style={{ ...ghostBtn, flex: 1 }}
            >
              {helmTesting ? <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <ShieldCheck size={14} color={ACCENT} />}
              {helmTesting ? 'Testing…' : 'Test Handshake'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => setStep(1)}
              style={{ ...ghostBtn, width: 'auto' }}
            >
              <ArrowLeft size={14} /> Back
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              style={btnStyle(ACCENT)}
            >
              {helmUrl && helmEmail ? 'Save & Continue' : 'Skip for now'} <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Admin Account ── */}
      {step === 3 && (
        <form onSubmit={finishSetup}>
          <Field
            label="Administrator Name"
            type="text"
            placeholder="Your full name"
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            autoFocus
            required
          />
          <Field
            label="Login Email"
            type="email"
            placeholder="admin@yourwarehouse.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
          <Field
            label="Password (min 8 characters)"
            type="password"
            placeholder="••••••••••••"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={busy}
              style={{ ...ghostBtn, width: 'auto' }}
            >
              <ArrowLeft size={14} /> Back
            </button>
            <button
              type="submit"
              disabled={busy}
              style={btnStyle(ACCENT, busy)}
            >
              {busy ? 'Setting up…' : 'Finish Setup & Launch OS'} <Check size={15} />
            </button>
          </div>
        </form>
      )}
    </Shell>
  );
}

export function AuthLoading() {
  return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0B1220', color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>Loading…</div>;
}
