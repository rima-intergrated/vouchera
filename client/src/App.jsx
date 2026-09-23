import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AppLayout from './layouts/AppLayout.jsx';
import Login from './pages/Login.jsx';
import AcceptInvite from './pages/AcceptInvite.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import ForgotPin from './pages/ForgotPin.jsx';
import ResetPin from './pages/ResetPin.jsx';
import TwoFactorSetup from './pages/TwoFactorSetup.jsx';
import Security from './pages/Security.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Cashier from './pages/Cashier.jsx';
import CashierVoucher from './pages/CashierVoucher.jsx';
import CashierHistory from './pages/CashierHistory.jsx';
import Reports from './pages/Reports.jsx';
import Vouchers from './pages/Vouchers.jsx';
import VoucherCreate from './pages/VoucherCreate.jsx';
import VoucherDetails from './pages/VoucherDetails.jsx';
import Redemptions from './pages/Redemptions.jsx';
import AuditLogs from './pages/AuditLogs.jsx';
import Campaigns from './pages/Campaigns.jsx';
import CampaignForm from './pages/CampaignForm.jsx';
import CampaignDetails from './pages/CampaignDetails.jsx';
import Portal from './pages/Portal.jsx';
import PortalHistory from './pages/PortalHistory.jsx';
import Customers from './pages/Customers.jsx';
import CustomerDetails from './pages/CustomerDetails.jsx';
import Approvals from './pages/Approvals.jsx';
import Shifts from './pages/Shifts.jsx';
import Users from './pages/Users.jsx';
import Stores from './pages/Stores.jsx';
import Settings from './pages/Settings.jsx';
import Placeholder from './pages/Placeholder.jsx';
import NotFound from './pages/NotFound.jsx';

const STAFF = ['ADMIN', 'MANAGER', 'AUDITOR'];

// Code-split: the camera library (~350KB) loads only when a cashier opens /cashier/scan.
const CashierScan = lazy(() => import('./pages/CashierScan.jsx'));

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/accept-invite" element={<AcceptInvite />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/forgot-pin" element={<ForgotPin />} />
          <Route path="/reset-pin" element={<ResetPin />} />
          <Route path="/setup-2fa" element={<TwoFactorSetup />} />
          <Route path="/register" element={<Register />} />
          <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
            <Route
              index
              element={
                <ProtectedRoute roles={STAFF} fallback="/cashier">
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            <Route path="/cashier" element={<Cashier />} />
            <Route path="/cashier/scan" element={<Suspense fallback={<div className="cashier-wrap"><p className="muted">Loading scanner…</p></div>}><CashierScan /></Suspense>} />
            <Route path="/cashier/voucher/:code" element={<CashierVoucher />} />
            <Route path="/cashier/history" element={<CashierHistory />} />
            <Route path="/portal" element={<ProtectedRoute roles={['CUSTOMER']} fallback="/"><Portal /></ProtectedRoute>} />
            <Route path="/portal/history" element={<ProtectedRoute roles={['CUSTOMER']} fallback="/"><PortalHistory /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute roles={STAFF} fallback="/cashier"><Reports /></ProtectedRoute>} />
            <Route path="/vouchers" element={<ProtectedRoute roles={STAFF} fallback="/cashier"><Vouchers /></ProtectedRoute>} />
            <Route path="/vouchers/new" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']} fallback="/vouchers"><VoucherCreate /></ProtectedRoute>} />
            <Route path="/vouchers/:id" element={<ProtectedRoute roles={STAFF} fallback="/cashier"><VoucherDetails /></ProtectedRoute>} />
            <Route path="/campaigns" element={<ProtectedRoute roles={STAFF} fallback="/cashier"><Campaigns /></ProtectedRoute>} />
            <Route path="/campaigns/new" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']} fallback="/campaigns"><CampaignForm /></ProtectedRoute>} />
            <Route path="/campaigns/:id" element={<ProtectedRoute roles={STAFF} fallback="/cashier"><CampaignDetails /></ProtectedRoute>} />
            <Route path="/campaigns/:id/edit" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']} fallback="/campaigns"><CampaignForm /></ProtectedRoute>} />
            <Route path="/customers" element={<ProtectedRoute roles={STAFF} fallback="/cashier"><Customers /></ProtectedRoute>} />
            <Route path="/customers/:id" element={<ProtectedRoute roles={STAFF} fallback="/cashier"><CustomerDetails /></ProtectedRoute>} />
            <Route path="/approvals" element={<ProtectedRoute roles={['ADMIN']} fallback="/"><Approvals /></ProtectedRoute>} />
            <Route path="/shifts" element={<ProtectedRoute roles={STAFF} fallback="/cashier"><Shifts /></ProtectedRoute>} />
            <Route path="/security" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']} fallback="/"><Security /></ProtectedRoute>} />
            <Route path="/stores" element={<ProtectedRoute roles={STAFF} fallback="/cashier"><Stores /></ProtectedRoute>} />
            <Route path="/users" element={<ProtectedRoute roles={['ADMIN']} fallback="/"><Users /></ProtectedRoute>} />
            <Route path="/redemptions" element={<ProtectedRoute roles={STAFF} fallback="/cashier"><Redemptions /></ProtectedRoute>} />
            <Route path="/audit-logs" element={<ProtectedRoute roles={['ADMIN', 'AUDITOR']} fallback="/"><AuditLogs /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute roles={['ADMIN']} fallback="/"><Settings /></ProtectedRoute>} />
          </Route>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
