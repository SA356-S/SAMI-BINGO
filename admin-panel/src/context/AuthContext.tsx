import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { login as apiLogin, resetAdminApiReady } from '../services/api';
import {
  clearAdminToken,
  getAdminRole,
  getAdminToken,
  isAuthenticated,
  setAdminSession,
  type AdminRole,
} from '../services/auth';
import { connectAdminSocket, disconnectAdminSocket } from '../services/socket';

interface AuthContextValue {
  authed: boolean;
  role: AdminRole | null;
  isManager: boolean;
  login: (password: string, telegramId: string) => Promise<void>;
  logout: () => void;
  error: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(isAuthenticated());
  const [role, setRole] = useState<AdminRole | null>(getAdminRole());
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(async (password: string, telegramId: string) => {
    setError(null);
    const res = await apiLogin(password, telegramId.trim());
    if (!res.ok || !res.token || !res.role) {
      throw new Error('Login failed');
    }
    setAdminSession(res.token, res.telegramId ?? telegramId, res.role);
    setRole(res.role);
    setAuthed(true);
    resetAdminApiReady();
    connectAdminSocket();
  }, []);

  const logout = useCallback(() => {
    clearAdminToken();
    disconnectAdminSocket();
    resetAdminApiReady();
    setAuthed(false);
    setRole(null);
  }, []);

  const value = useMemo(
    () => ({
      authed,
      role,
      isManager: role === 'manager',
      login,
      logout,
      error,
    }),
    [authed, role, login, logout, error]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

export function useAuthBootstrap() {
  if (getAdminToken()) connectAdminSocket();
}
