import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './auth/AuthContext.jsx'
import Login from './auth/Login.jsx'
import { Shell } from './components/Shell.jsx'
import { Spinner } from './components/ui.jsx'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'

import NewTask from './pages/operator/NewTask.jsx'
import OpenTasks from './pages/operator/OpenTasks.jsx'
import CompleteTask from './pages/operator/CompleteTask.jsx'
import OperatorSummary from './pages/operator/OperatorSummary.jsx'

import AdminRecords from './pages/admin/AdminRecords.jsx'
import EditTask from './pages/admin/EditTask.jsx'
import AddTask from './pages/admin/AddTask.jsx'
import Settings from './pages/admin/Settings.jsx'

export default function App() {
  const { ready, user } = useAuth()

  if (!ready) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center text-brand">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={user ? <RootRedirect /> : <Login />} />

      {/* Operator area */}
      <Route element={<RequireRole role="operator" />}>
        <Route element={<Shell role="operator" />}>
          <Route path="/open" element={<OpenTasks />} />
          <Route path="/open/new" element={<NewTask />} />
          <Route path="/open/:id" element={<CompleteTask />} />
          <Route path="/summary" element={<OperatorSummary />} />
        </Route>
      </Route>

      {/* Admin area */}
      <Route element={<RequireRole role="admin" />}>
        <Route element={<Shell role="admin" />}>
          <Route path="/admin" element={<Navigate to="/admin/records" replace />} />
          <Route path="/admin/records" element={<AdminRecords />} />
          <Route path="/admin/task/:id" element={<EditTask />} />
          <Route path="/admin/add" element={<AddTask />} />
          <Route path="/admin/settings" element={<Settings />} />
        </Route>
      </Route>

        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </ErrorBoundary>
  )
}

function RootRedirect() {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  return <Navigate to={user.role === 'admin' ? '/admin/records' : '/open'} replace />
}

function RequireRole({ role }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== role) return <RootRedirect />
  return <Outlet />
}
