import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import AppShell from './components/layout/AppShell';
import Dashboard from './pages/Dashboard';
import CustomerList from './pages/customers/CustomerList';
import CustomerRecord from './pages/customers/CustomerRecord';
import TrackingPage from './pages/tracking/TrackingPage';
import PurchaseOrdersPage from './pages/purchaseOrders/PurchaseOrdersPage';
import PickingPage from './pages/picking/PickingPage';
import StoragePage from './pages/storage/StoragePage';
import OnTimePage from './pages/sla/OnTimePage';
import ReturnsPage from './pages/returns/ReturnsPage';
import NotificationCenter from './pages/notifications/NotificationCenter';
import UsersPage from './pages/users/UsersPage';
import QueriesPage from './pages/queries/QueriesPage';
import WarehouseBoard from './pages/warehouse/WarehouseBoard';
import { LoginScreen, SetupScreen, AuthLoading } from './pages/auth/AuthScreens';
import Placeholder from './pages/Placeholder';

// Public, login-free TV board lives outside the auth gate and the app shell.
function AppRoutes() {
  return (
    <Routes>
      <Route path="/warehouse" element={<WarehouseBoard />} />
      <Route path="/*" element={<GatedApp />} />
    </Routes>
  );
}

function GatedApp() {
  const { user, needsSetup, loading } = useAuth();
  if (loading) return <AuthLoading />;
  if (needsSetup) return <SetupScreen />;
  if (!user) return <LoginScreen />;
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
        <Route path="storage"         element={<StoragePage />} />
        <Route path="on-time"         element={<OnTimePage />} />
        <Route path="returns"         element={<ReturnsPage />} />
        <Route path="notifications"   element={<NotificationCenter />} />
        <Route path="users"           element={<UsersPage />} />
        <Route path="queries"       element={<QueriesPage />} />
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
