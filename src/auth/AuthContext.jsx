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
          // Drop stale operator/site-admin sessions that predate the account model.
          if ((u?.role === Role.OPERATOR || u?.role === Role.SITEADMIN) && !u.operatorId) {
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

  // Operator login: type your username (case-insensitive) + PIN. The list of
  // operators/companies is never shown to operators.
  const loginOperator = useCallback(
    async ({ username, pin, expect }) => {
      const uname = (username || '').trim().toLowerCase()
      if (!uname) throw new Error('Enter your username.')
      const all = await db.operators.toArray()
      const op = all.find((o) => o.active && (o.name || '').trim().toLowerCase() === uname)
      // Check the username first, then the PIN.
      if (!op) throw new Error('Username does not exist.')
      if (!op.pinHash) throw new Error('No PIN set yet. Ask the admin.')
      if (!(await verifySecret(pin, op.pinHash))) throw new Error('Incorrect PIN.')
      if (expect === 'siteadmin' && !op.isSiteAdmin) {
        throw new Error('This is not a site-admin account. Use the Operator login.')
      }
      if (expect === 'operator' && op.isSiteAdmin) {
        throw new Error('This is a site-admin account. Use the Site Admin login.')
      }
      const company = op.companyId ? await db.companies.get(op.companyId) : null
      const session = {
        role: op.isSiteAdmin ? Role.SITEADMIN : Role.OPERATOR,
        operatorId: op.id,
        operatorName: op.name,
        companyId: op.companyId || null,
        companyName: company?.name || '',
        name: op.name, // shown in the top bar
        loginAt: new Date().toISOString() // used by the force-logout check
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

  const logout = useCallback(() => persist(null), [persist])

  const value = {
    user,
    ready,
    adminConfigured,
    lastOperator,
    isAdmin: user?.role === Role.ADMIN,
    isSiteAdmin: user?.role === Role.SITEADMIN,
    isOperator: user?.role === Role.OPERATOR,
    setupAdmin,
    loginAdmin,
    loginOperator,
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
