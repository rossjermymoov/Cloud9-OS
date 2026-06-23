import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import AppShell from './components/layout/AppShell';
import LoginPage from './pages/auth/LoginPage';
import CustomerList from './pages/customers/CustomerList';
import CustomerRecord from './pages/customers/CustomerRecord';
import CustomerNew from './pages/customers/CustomerNew';
import CustomerAI from './pages/customers/CustomerAI';
import StaffSettings from './pages/settings/StaffSettings';
import RulesSettings from './pages/settings/RulesSettings';
import CommsTemplates from './pages/settings/CommsTemplates';
import Switchboard from './pages/settings/Switchboard';
import BillingSettings from './pages/settings/BillingSettings';
import XeroSettings from './pages/settings/XeroSettings';
import VolumetricSettings from './pages/settings/VolumetricSettings';
import EmailSettings from './pages/settings/EmailSettings';
import GmailSettings from './pages/settings/GmailSettings';
import CarrierManagement from './pages/carriers/CarrierManagement';
import TrackingPage from './pages/tracking/TrackingPage';
import FinancePage from './pages/finance/FinancePage';
import QueriesPage from './pages/queries/QueriesPage';
import TicketDetailPage from './pages/queries/TicketDetailPage';
import SimulatorPanel from './pages/queries/SimulatorPanel';
import CustomerSimPage from './pages/customer/CustomerSimPage';
import KatanaPage from './pages/katana/KatanaPage';
import PricingPage from './pages/pricing/PricingPage';
import RateCardEditor from './pages/pricing/RateCardEditor';
import ReconciliationPage from './pages/reconciliation/ReconciliationPage';
import RunDetailPage from './pages/reconciliation/RunDetailPage';
import MarginReportPage from './pages/reconciliation/MarginReportPage';
import ServiceCodeMappingsPage from './pages/reconciliation/ServiceCodeMappingsPage';

// Placeholder pages for other sections (to be built)
const Placeholder = ({ name }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, color: '#64748B' }}>
    <div style={{ fontSize: 40, marginBottom: 12 }}>🚧</div>
    <div style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>{name}</div>
    <div style={{ fontSize: 13 }}>This section is coming soon</div>
  </div>
);

// ─── RequireAuth ─────────────────────────────────────────────────────────────
// Renders children if authenticated (or bypass mode is active).
// Otherwise redirects to /login, preserving the attempted URL.

function RequireAuth({ children }) {
  const { user, loading, bypass } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ background: '#F8FAFC', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#64748B', fontSize: 14 }}>Loading…</span>
      </div>
    );
  }

  if (!bypass && !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}

// ─── AppRoutes ────────────────────────────────────────────────────────────────

function AppRoutes() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<LoginPage />} />

      {/* Protected — wrapped in RequireAuth */}
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Placeholder name="Dashboard" />} />

        {/* Customers — nested so "new" is always resolved before ":id" */}
        <Route path="customers">
          <Route index element={<CustomerList />} />
          <Route path="new" element={<CustomerNew />} />
          <Route path="ai-new" element={<CustomerAI />} />
          <Route path=":id" element={<CustomerRecord />} />
        </Route>

        <Route path="pricing">
          <Route index element={<PricingPage />} />
          <Route path="rate-card/:id" element={<RateCardEditor />} />
        </Route>
        <Route path="tracking"  element={<TrackingPage />} />
        <Route path="finance"   element={<FinancePage />} />
        <Route path="queries">
          <Route index element={<QueriesPage />} />
          <Route path="simulator" element={<SimulatorPanel />} />
          <Route path=":id" element={<TicketDetailPage />} />
        </Route>
        <Route path="customer-sim"  element={<CustomerSimPage />} />
        <Route path="carriers"      element={<CarrierManagement />} />
        <Route path="reconciliation">
          <Route index element={<ReconciliationPage />} />
          <Route path="margin-report" element={<MarginReportPage />} />
          <Route path="service-code-mappings" element={<ServiceCodeMappingsPage />} />
          <Route path=":id" element={<RunDetailPage />} />
        </Route>
        <Route path="reports"   element={<Placeholder name="Dashboards & Reporting" />} />
        <Route path="knowledge" element={<KatanaPage />} />
        <Route path="settings">
          <Route index element={<StaffSettings />} />
          <Route path="staff"       element={<StaffSettings />} />
          <Route path="rules"       element={<RulesSettings />} />
          <Route path="comms-templates" element={<CommsTemplates />} />
          <Route path="switchboard"     element={<Switchboard />} />
          <Route path="volumetric"  element={<VolumetricSettings />} />
          <Route path="billing"     element={<BillingSettings />} />
          <Route path="xero"        element={<XeroSettings />} />
          <Route path="email"       element={<EmailSettings />} />
          <Route path="gmail"       element={<GmailSettings />} />
        </Route>
        <Route path="*"         element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
