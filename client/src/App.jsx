import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import AppShell from './components/layout/AppShell';
import Dashboard from './pages/Dashboard';
import CustomerList from './pages/customers/CustomerList';
import CustomerRecord from './pages/customers/CustomerRecord';
import TrackingPage from './pages/tracking/TrackingPage';
import PurchaseOrdersPage from './pages/purchaseOrders/PurchaseOrdersPage';
import PickingPage from './pages/picking/PickingPage';
import ReturnsPage from './pages/returns/ReturnsPage';
import NotificationCenter from './pages/notifications/NotificationCenter';
import Placeholder from './pages/Placeholder';

// Phase 0: auth gating is off until the auth backend is brought across.
function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="customers">
          <Route index element={<CustomerList />} />
          <Route path=":id" element={<CustomerRecord />} />
        </Route>
        <Route path="tracking"        element={<TrackingPage />} />
        <Route path="purchase-orders" element={<PurchaseOrdersPage />} />
        <Route path="picking"         element={<PickingPage />} />
        <Route path="returns"         element={<ReturnsPage />} />
        <Route path="notifications"   element={<NotificationCenter />} />
        <Route path="queries"       element={<Placeholder name="Queries & Claims" note="Copied from Moov OS in a later phase." />} />
        <Route path="settings"      element={<Placeholder name="Settings" note="Xero, Gmail inbox and webhook config live here." />} />
        <Route path="*"             element={<Navigate to="/" replace />} />
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
