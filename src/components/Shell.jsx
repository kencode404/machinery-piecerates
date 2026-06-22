import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'
import { useSync } from '../sync/useSync.js'
import { IconList, IconChart, IconCog, IconLogout, IconCloud, IconCloudOff, IconReport } from './icons.jsx'

const OPERATOR_NAV = [
  { to: '/open', label: 'Open', Icon: IconList },
  { to: '/summary', label: 'Summary', Icon: IconChart }
]

const ADMIN_NAV = [
  { to: '/admin/dashboard', label: 'Dashboard', Icon: IconChart },
  { to: '/admin/records', label: 'Records', Icon: IconList },
  { to: '/admin/payroll', label: 'Payroll', Icon: IconReport },
  { to: '/admin/settings', label: 'Settings', Icon: IconCog }
]

const SITEADMIN_NAV = [{ to: '/admin/records', label: 'Records', Icon: IconChart }]

export function Shell() {
  const { user } = useAuth()
  const role = user?.role
  const nav = role === 'admin' ? ADMIN_NAV : role === 'siteadmin' ? SITEADMIN_NAV : OPERATOR_NAV
  // Payroll + claim form get a wider column on desktop.
  const { pathname } = useLocation()
  const wide =
    pathname.startsWith('/admin/payroll') ||
    pathname.startsWith('/admin/claim') ||
    pathname.startsWith('/admin/dashboard')
  return (
    <div className={`mx-auto flex min-h-[100dvh] w-full flex-col ${wide ? 'max-w-app lg:max-w-5xl' : 'max-w-app'}`}>
      <TopBar role={role} />
      <main className="content-pad-bottom flex-1 px-4 pt-3">
        <Outlet />
      </main>
      <BottomNav items={nav} />
    </div>
  )
}

function TopBar({ role }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  return (
    <header className="pt-safe sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur print:hidden">
      <div className="flex h-14 items-center justify-between px-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-800">{user?.name || 'User'}</p>
          <p className="truncate text-[11px] uppercase tracking-wide text-slate-400">
            {role === 'admin'
              ? 'Administrator'
              : role === 'siteadmin'
                ? `Site admin · ${user?.companyName || ''}`
                : 'Operator'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SyncStatus />
          <button
            onClick={() => {
              logout()
              navigate('/login', { replace: true })
            }}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 active:bg-slate-100"
            aria-label="Log out"
          >
            <IconLogout width={20} height={20} />
          </button>
        </div>
      </div>
    </header>
  )
}

export function SyncStatus() {
  const { enabled, online, syncing, pending, pendingTasks, lastError } = useSync()
  const tasksLabel = `${pendingTasks} ${pendingTasks === 1 ? 'task' : 'tasks'} to sync`

  if (!enabled) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500">
        Offline mode
      </span>
    )
  }

  if (!online) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-700">
        <IconCloudOff width={14} height={14} />
        {pendingTasks > 0 ? tasksLabel : 'Offline'}
      </span>
    )
  }

  if (syncing) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-brand-light px-2.5 py-1 text-xs text-brand-dark">
        <IconCloud width={14} height={14} className="animate-pulse" />
        Syncing…
      </span>
    )
  }

  if (lastError) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs text-red-700">
        Sync error
      </span>
    )
  }

  if (pendingTasks > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-700">
        {tasksLabel}
      </span>
    )
  }

  // Only admin setting changes / deletions left to push.
  if (pending > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-700">
        Saving changes…
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-xs text-green-700">
      <IconCloud width={14} height={14} />
      Synced
    </span>
  )
}

function BottomNav({ items }) {
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-20 mx-auto max-w-app border-t border-slate-200 bg-white print:hidden">
      <div className="flex">
        {items.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              [
                'flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] font-medium',
                isActive ? 'text-brand' : 'text-slate-400'
              ].join(' ')
            }
          >
            <Icon width={22} height={22} />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
