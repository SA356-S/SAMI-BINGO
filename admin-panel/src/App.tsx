import type { ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth, useAuthBootstrap } from './context/AuthContext';
import { GameProvider } from './context/GameContext';
import type { AdminRole } from './services/auth';

import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import GamePage from './pages/GamePage';
import PlayersPage from './pages/PlayersPage';
import CartelasPage from './pages/CartelasPage';
import PaymentsPage from './pages/PaymentsPage';
import UserBalancePage from './pages/UserBalancePage';
import UserManagementPage from './pages/UserManagementPage';
import RobotsPage from './pages/RobotsPage';
import BroadcastPage from './pages/BroadcastPage';
import WithdrawRequestsPage from './pages/WithdrawRequestsPage';
import RegistrationBonusPage from './pages/RegistrationBonusPage';
import FirstDepositBonusPage from './pages/FirstDepositBonusPage';
import AdminLayout from './components/AdminLayout';

function ProtectedRoute() {
  const { authed } = useAuth();
  const location = useLocation();

  if (!authed) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

function HomeRedirect() {
  const { role } = useAuth();
  return (
    <Navigate
      to={role === 'admin' ? '/withdraw-requests' : '/dashboard'}
      replace
    />
  );
}

function RoleRoute({ roles, children }: { roles: AdminRole[]; children: ReactNode }) {
  const { role, authed } = useAuth();
  if (!authed) return <Navigate to="/login" replace />;
  if (!role || !roles.includes(role)) {
    return <Navigate to={role === 'admin' ? '/withdraw-requests' : '/dashboard'} replace />;
  }
  return <>{children}</>;
}

function ProtectedAdminLayout() {
  useAuthBootstrap();
  return (
    <GameProvider>
      <AdminLayout />
    </GameProvider>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<ProtectedAdminLayout />}>
          <Route index element={<HomeRedirect />} />
          <Route
            path="/dashboard"
            element={
              <RoleRoute roles={['manager']}>
                <DashboardPage />
              </RoleRoute>
            }
          />
          <Route
            path="/game"
            element={
              <RoleRoute roles={['manager']}>
                <GamePage />
              </RoleRoute>
            }
          />
          <Route
            path="/players"
            element={
              <RoleRoute roles={['manager']}>
                <PlayersPage />
              </RoleRoute>
            }
          />
          <Route
            path="/cartelas"
            element={
              <RoleRoute roles={['manager']}>
                <CartelasPage />
              </RoleRoute>
            }
          />
          <Route
            path="/payments"
            element={
              <RoleRoute roles={['manager']}>
                <PaymentsPage />
              </RoleRoute>
            }
          />
          <Route
            path="/withdraw-requests"
            element={
              <RoleRoute roles={['admin', 'manager']}>
                <WithdrawRequestsPage />
              </RoleRoute>
            }
          />
          <Route
            path="/user-balance"
            element={
              <RoleRoute roles={['manager']}>
                <UserBalancePage />
              </RoleRoute>
            }
          />
          <Route
            path="/registration-bonus"
            element={
              <RoleRoute roles={['manager']}>
                <RegistrationBonusPage />
              </RoleRoute>
            }
          />
          <Route
            path="/first-deposit-bonus"
            element={
              <RoleRoute roles={['manager']}>
                <FirstDepositBonusPage />
              </RoleRoute>
            }
          />
          <Route
            path="/user-management"
            element={
              <RoleRoute roles={['manager']}>
                <UserManagementPage />
              </RoleRoute>
            }
          />
          <Route
            path="/robots"
            element={
              <RoleRoute roles={['manager']}>
                <RobotsPage />
              </RoleRoute>
            }
          />
          <Route
            path="/broadcast"
            element={
              <RoleRoute roles={['admin', 'manager']}>
                <BroadcastPage />
              </RoleRoute>
            }
          />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/withdraw-requests" replace />} />
    </Routes>
  );
}


