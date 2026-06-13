import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { db, getMeta, setMeta } from '../db/database.js'
import { Role } from '../db/models.js'
import { hashSecret, verifySecret, randomCode } from '../lib/crypto.js'

const SESSION_KEY = 'mpr.session'
const AuthContext = createContext(null)

const normCode = (s) => (s || '').trim().toUpperCase()

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [adminConfigured, setAdminConfigured] = useState(false)
  const [ready, setReady] = useState(false)
  // Last operator selection on this device (to prefill the login form).
  const [lastOperator] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('mpr.lastOperator') || 'null')
    } catch {
      return null
    }
  })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const admin = await getMeta('adminAuth')
      if (cancelled) return
      setAdminConfigured(Boolean(admin?.passwordHash))
      try {
        const raw = localStorage.getItem(SESSION_KEY)
        if (raw) {
          const u = JSON.parse(raw)
          // Drop stale pre-company operator sessions (missing companyId/operatorName)
          // so the new login flow runs instead of crashing on an invalid query.
          if (u?.role === Role.OPERATOR && (!u.companyId || !u.operatorName)) {
            localStorage.removeItem(SESSION_KEY)
          } else {
            setUser(u)
          }
        }
      } catch {
        /* ignore corrupt session */
      }
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const persist = useCallback((u) => {
    setUser(u)
    try {
      if (u) localStorage.setItem(SESSION_KEY, JSON.stringify(u))
      else localStorage.removeItem(SESSION_KEY)
    } catch {
      /* private mode: in-memory only */
    }
  }, [])

  // First-time admin setup: choose a password, receive a recovery code (once).
  // Does NOT log in — the caller shows the recovery code first, then logs in.
  const setupAdmin = useCallback(async (password) => {
    const recoveryCode = randomCode()
    const [passwordHash, recoveryHash] = await Promise.all([
      hashSecret(password),
      hashSecret(normCode(recoveryCode))
    ])
    await setMeta('adminAuth', { passwordHash, recoveryHash, updatedAt: new Date().toISOString() })
    setAdminConfigured(true)
    return recoveryCode
  }, [])

  const loginAdmin = useCallback(
    async (password) => {
      const admin = await getMeta('adminAuth')
      if (!admin?.passwordHash) throw new Error('Admin is not set up yet.')
      if (!(await verifySecret(password, admin.passwordHash))) throw new Error('Wrong password.')
      persist({ role: Role.ADMIN, name: 'Admin' })
    },
    [persist]
  )

  // Operator login: Company -> Machine -> per-machine PIN -> typed username.
  const loginOperator = useCallback(
    async ({ companyId, machineId, pin, username }) => {
      const name = (username || '').trim()
      if (!companyId) throw new Error('Choose a company.')
      if (!machineId) throw new Error('Choose a machine.')
      if (!name) throw new Error('Enter your name.')
      const machine = await db.machines.get(machineId)
      if (!machine || !machine.active || machine.companyId !== companyId) {
        throw new Error('Machine not found.')
      }
      if (!machine.pinHash) throw new Error('This machine has no PIN yet. Ask the admin.')
      if (!(await verifySecret(pin, machine.pinHash))) throw new Error('Wrong PIN.')
      const company = await db.companies.get(companyId)
      const session = {
        role: Role.OPERATOR,
        companyId,
        companyName: company?.name || '',
        machineId,
        machineName: machine.name || '',
        operatorName: name,
        name // shown in the top bar
      }
      try {
        localStorage.setItem('mpr.lastOperator', JSON.stringify({ companyId, machineId, operatorName: name }))
      } catch {
        /* ignore */
      }
      persist(session)
    },
    [persist]
  )

  // Forgot admin password -> verify recovery code -> set new password.
  // Returns a freshly generated recovery code (the old one stops working).
  const resetAdminPassword = useCallback(async (recoveryCode, newPassword) => {
    const admin = await getMeta('adminAuth')
    if (!admin?.recoveryHash) throw new Error('No recovery code is on file for this device.')
    if (!(await verifySecret(normCode(recoveryCode), admin.recoveryHash))) {
      throw new Error('Recovery code is incorrect.')
    }
    const newRecovery = randomCode()
    const [passwordHash, recoveryHash] = await Promise.all([
      hashSecret(newPassword),
      hashSecret(normCode(newRecovery))
    ])
    await setMeta('adminAuth', { ...admin, passwordHash, recoveryHash, updatedAt: new Date().toISOString() })
    return newRecovery
  }, [])

  const changeAdminPassword = useCallback(async (oldPassword, newPassword) => {
    const admin = await getMeta('adminAuth')
    if (!(await verifySecret(oldPassword, admin?.passwordHash))) {
      throw new Error('Current password is wrong.')
    }
    const passwordHash = await hashSecret(newPassword)
    await setMeta('adminAuth', { ...admin, passwordHash, updatedAt: new Date().toISOString() })
  }, [])

  const regenerateRecovery = useCallback(async () => {
    const admin = await getMeta('adminAuth')
    if (!admin?.passwordHash) throw new Error('Admin is not set up yet.')
    const newRecovery = randomCode()
    const recoveryHash = await hashSecret(normCode(newRecovery))
    await setMeta('adminAuth', { ...admin, recoveryHash, updatedAt: new Date().toISOString() })
    return newRecovery
  }, [])

  // Change the display name after login (records keep the name used at the time).
  const updateOperatorName = useCallback((name) => {
    const trimmed = (name || '').trim()
    if (!trimmed) return
    setUser((prev) => {
      if (!prev) return prev
      const next = { ...prev, operatorName: trimmed, name: trimmed }
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(next))
        const last = JSON.parse(localStorage.getItem('mpr.lastOperator') || 'null') || {}
        localStorage.setItem('mpr.lastOperator', JSON.stringify({ ...last, operatorName: trimmed }))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const logout = useCallback(() => persist(null), [persist])

  const value = {
    user,
    ready,
    adminConfigured,
    lastOperator,
    isAdmin: user?.role === Role.ADMIN,
    isOperator: user?.role === Role.OPERATOR,
    setupAdmin,
    loginAdmin,
    loginOperator,
    updateOperatorName,
    resetAdminPassword,
    changeAdminPassword,
    regenerateRecovery,
    logout
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
