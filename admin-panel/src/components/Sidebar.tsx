import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { AdminRole } from '../services/auth';

type NavItem = {
  to: string;
  label: string;
  roles: AdminRole[];
};

const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', roles: ['manager'] },
  { to: '/game', label: 'Game', roles: ['manager'] },
  { to: '/players', label: 'Players', roles: ['manager'] },
  { to: '/cartelas', label: 'Cartelas', roles: ['manager'] },
  { to: '/payments', label: 'Payments', roles: ['manager'] },
  { to: '/withdraw-requests', label: 'Withdraw Requests', roles: ['admin', 'manager'] },
  { to: '/user-balance', label: 'User Balance', roles: ['manager'] },
  { to: '/registration-bonus', label: 'Registration Bonus', roles: ['manager'] },
  { to: '/first-deposit-bonus', label: 'First Deposit Bonus', roles: ['manager'] },
  { to: '/user-management', label: 'User Management', roles: ['manager'] },
  { to: '/robots', label: 'Robots', roles: ['manager'] },
  { to: '/broadcast', label: 'Broadcast', roles: ['admin', 'manager'] },
];

export default function Sidebar() {
  const { role, logout } = useAuth();
  const items = NAV.filter((item) => role && item.roles.includes(role));

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-panel-border bg-[#0b0f1a] p-4">
      <div className="mb-5">
        <p className="text-sm font-bold tracking-wide text-white/90">
          EDIL BINGO • ADMIN
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Role: <span className="uppercase text-indigo-200">{role ?? '—'}</span>
        </p>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/dashboard'}
            className={({ isActive }) =>
              [
                'flex items-center justify-start gap-2 rounded-lg px-3 py-2 text-sm font-medium transition',
                isActive
                  ? 'border border-indigo-400/20 bg-indigo-500/15 text-indigo-200'
                  : 'text-slate-300 hover:bg-white/5 hover:text-white',
              ].join(' ')
            }
          >
            <span className="h-2 w-2 rounded-full bg-indigo-400/70" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <button
        type="button"
        onClick={logout}
        className="mt-4 rounded-lg border border-white/10 px-3 py-2 text-left text-sm font-medium text-slate-300 hover:bg-white/5 hover:text-white"
      >
        Log out
      </button>
    </aside>
  );
}
