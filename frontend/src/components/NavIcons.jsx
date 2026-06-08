/** Bottom nav icons — colorful idle style (screenshot reference); active state handled in Navbar */

function IconWrap({ className = 'h-9 w-9', children }) {
  return (
    <svg
      viewBox="0 0 24 32"
      className={className}
      aria-hidden="true"
      preserveAspectRatio="xMidYMid meet"
    >
      {children}
    </svg>
  );
}

/** Grey gamepad with D-pad + colored face buttons */
export function NavIconGame({ className = 'h-9 w-9' }) {
  return (
    <IconWrap className={className}>
      <path d="M9.5 10 H14.5 L14 12 H10 Z" fill="#9CA3AF" />
      <rect x="3" y="12" width="18" height="11" rx="5" fill="#6B7280" />
      <rect x="4" y="13" width="16" height="9" rx="4" fill="#D1D5DB" />
      <rect x="5.5" y="15.8" width="4.2" height="1.1" rx="0.35" fill="#4B5563" />
      <rect x="6.9" y="14.4" width="1.1" height="4.2" rx="0.35" fill="#4B5563" />
      <circle cx="14.8" cy="14.8" r="1.05" fill="#EF4444" />
      <circle cx="17.2" cy="14.8" r="1.05" fill="#EAB308" />
      <circle cx="14.8" cy="17.2" r="1.05" fill="#22C55E" />
      <circle cx="17.2" cy="17.2" r="1.05" fill="#3B82F6" />
      <rect x="4.5" y="13.5" width="5" height="2.5" rx="0.8" fill="#F3F4F6" opacity="0.25" />
    </IconWrap>
  );
}

/** Gold trophy on brown base */
export function NavIconScores({ className = 'h-9 w-9' }) {
  return (
    <IconWrap className={className}>
      <defs>
        <linearGradient id="nav-trophy-gold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FEF08A" />
          <stop offset="45%" stopColor="#FBBF24" />
          <stop offset="100%" stopColor="#D97706" />
        </linearGradient>
      </defs>
      <ellipse cx="12" cy="25.2" rx="5.2" ry="1.1" fill="#78350F" opacity="0.6" />
      <rect x="8.2" y="22.2" width="7.6" height="2" rx="0.5" fill="#92400E" />
      <path
        d="M7 5 H17 V9 C17 13 14.5 15.5 12 15.5 V19 H15 V22 H9 V19 H12 V15.5 C9 15.5 7 13 7 9 Z"
        fill="url(#nav-trophy-gold)"
      />
      <path
        d="M7 5 H5.5 C5.5 8.5 6.5 9.5 7.5 9.5 M17 5 H18.5 C18.5 8.5 17.5 9.5 16.5 9.5"
        fill="#FDE047"
      />
      <ellipse cx="12" cy="8" rx="2.4" ry="1.2" fill="#FFFBEB" opacity="0.7" />
    </IconWrap>
  );
}

/** Light blue-grey analog clock, hands at ~3:00 */
export function NavIconHistory({ className = 'h-9 w-9' }) {
  return (
    <IconWrap className={className}>
      <circle cx="12" cy="16" r="9" fill="#64748B" />
      <circle cx="12" cy="16" r="7.6" fill="#E2E8F0" />
      <circle cx="12" cy="16" r="6.2" fill="#F1F5F9" />
      <circle cx="12" cy="16" r="0.9" fill="#334155" />
      <line
        x1="12"
        y1="16"
        x2="12"
        y2="10.5"
        stroke="#1E293B"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <line
        x1="12"
        y1="16"
        x2="16.5"
        y2="16"
        stroke="#1E293B"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <circle cx="12" cy="7.8" r="0.75" fill="#94A3B8" />
      <circle cx="19.8" cy="16" r="0.75" fill="#94A3B8" />
      <circle cx="12" cy="24.2" r="0.75" fill="#94A3B8" />
      <circle cx="4.2" cy="16" r="0.75" fill="#94A3B8" />
    </IconWrap>
  );
}

/** Brown briefcase with handle and clasp */
export function NavIconWallet({ className = 'h-9 w-9' }) {
  return (
    <IconWrap className={className}>
      <path
        d="M9 9.5 C9 8.5 9.8 8 10.5 8 H13.5 C14.2 8 15 8.5 15 9.5 V10.5 H9 Z"
        fill="#78350F"
      />
      <rect x="4.5" y="10.5" width="15" height="12.5" rx="2" fill="#92400E" />
      <rect x="5.5" y="11.5" width="13" height="10.5" rx="1.5" fill="#B45309" />
      <rect x="5.5" y="11.5" width="13" height="4.5" rx="1" fill="#D97706" opacity="0.45" />
      <rect x="10.5" y="14" width="3" height="2.2" rx="0.5" fill="#78716C" />
      <rect x="11.2" y="14.6" width="1.6" height="1" rx="0.25" fill="#E7E5E4" />
      <rect x="7" y="19.5" width="10" height="1" rx="0.3" fill="#FBBF24" opacity="0.35" />
    </IconWrap>
  );
}

/** Solid blue profile silhouette */
export function NavIconProfile({ className = 'h-9 w-9' }) {
  return (
    <IconWrap className={className}>
      <defs>
        <linearGradient id="nav-avatar-blue" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#60A5FA" />
          <stop offset="100%" stopColor="#2563EB" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="16" r="9" fill="url(#nav-avatar-blue)" />
      <circle cx="12" cy="12.2" r="3.4" fill="#EFF6FF" />
      <ellipse cx="12" cy="21.2" rx="5.4" ry="3.4" fill="#DBEAFE" />
      <ellipse cx="9.4" cy="10.8" rx="1.1" ry="0.7" fill="#FFFFFF" opacity="0.3" />
    </IconWrap>
  );
}

export const NAV_ICON_MAP = {
  home: NavIconGame,
  scores: NavIconScores,
  history: NavIconHistory,
  wallet: NavIconWallet,
  profile: NavIconProfile,
};
