import { useState } from 'react'
import { useAuth } from './AuthContext.jsx'
import { Button, Card, Field, TextInput } from '../components/ui.jsx'

// Single-screen auth flow with a few small modes.
export default function Login() {
  const auth = useAuth()
  const [mode, setMode] = useState('home') // home | operator | admin | setup | forgot | recovery
  const [recoveryCode, setRecoveryCode] = useState('')
  const [pendingPassword, setPendingPassword] = useState('')

  // After setup we show the recovery code, then log the admin in.
  function onSetupDone(code, password) {
    setRecoveryCode(code)
    setPendingPassword(password)
    setMode('recovery')
  }

  return (
    <div className="min-h-full px-5 pt-safe">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-app flex-col justify-center py-10">
        <div className="mb-8 text-center">
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" className="mx-auto h-16 w-16 rounded-2xl" />
          <h1 className="mt-3 text-xl font-bold text-slate-800">Machinery Piece Rates</h1>
          <p className="text-sm text-slate-400">Record your work — even offline</p>
        </div>

        {mode === 'home' && <Home onPick={setMode} />}
        {mode === 'operator' && <OperatorLogin kind="operator" onBack={() => setMode('home')} />}
        {mode === 'siteadmin' && <OperatorLogin kind="siteadmin" onBack={() => setMode('home')} />}
        {mode === 'admin' && (
          <AdminLogin
            onBack={() => setMode('home')}
            onForgot={() => setMode('forgot')}
            onNeedSetup={() => setMode('setup')}
            configured={auth.adminConfigured}
          />
        )}
        {mode === 'setup' && <AdminSetup onBack={() => setMode('admin')} onDone={onSetupDone} />}
        {mode === 'forgot' && (
          <ForgotPassword
            onBack={() => setMode('admin')}
            onReset={(code) => {
              setRecoveryCode(code)
              setPendingPassword('')
              setMode('recovery')
            }}
          />
        )}
        {mode === 'recovery' && (
          <RecoveryCodeScreen
            code={recoveryCode}
            onContinue={async () => {
              if (pendingPassword) {
                await auth.loginAdmin(pendingPassword) // setup flow -> straight in
              } else {
                setMode('admin') // reset flow -> sign in with new password
              }
            }}
          />
        )}
      </div>
    </div>
  )
}

function Home({ onPick }) {
  return (
    <div className="space-y-3">
      <Button full size="lg" onClick={() => onPick('operator')}>
        Operator
      </Button>
      <Button full size="lg" variant="secondary" onClick={() => onPick('siteadmin')}>
        Site Admin
      </Button>
      <Button full size="lg" variant="secondary" onClick={() => onPick('admin')}>
        HQ Admin
      </Button>
    </div>
  )
}

function OperatorLogin({ onBack, kind }) {
  const auth = useAuth()
  const [username, setUsername] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await auth.loginOperator({ username, pin, expect: kind })
    } catch (err) {
      setError(err.message)
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm font-semibold text-slate-700">
          {kind === 'siteadmin' ? 'Site admin sign in' : 'Operator sign in'}
        </p>
        <Field label="Username" required>
          <TextInput
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="your username"
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </Field>
        <Field label="PIN" required error={error}>
          <TextInput
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="••••"
            className="text-center text-2xl tracking-[0.5em]"
          />
        </Field>
        <Button full type="submit" disabled={busy || !username.trim() || pin.length < 3}>
          {busy ? 'Checking…' : 'Sign in'}
        </Button>
        <Button type="button" variant="ghost" full onClick={onBack}>
          ← Back
        </Button>
      </form>
    </Card>
  )
}

function AdminLogin({ onBack, onForgot, onNeedSetup, configured }) {
  const auth = useAuth()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!configured) {
    return (
      <Card className="p-4 text-center">
        <p className="text-sm text-slate-600">No admin has been set up on this device yet.</p>
        <Button full className="mt-4" onClick={onNeedSetup}>
          Set up admin
        </Button>
        <Button variant="ghost" full className="mt-2" onClick={onBack}>
          ← Back
        </Button>
      </Card>
    )
  }

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await auth.loginAdmin(password)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm font-semibold text-slate-700">HQ admin sign in</p>
        <Field label="HQ admin password" error={error}>
          <TextInput
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter HQ admin password"
          />
        </Field>
        <Button full type="submit" disabled={busy || !password}>
          {busy ? 'Checking…' : 'Sign in as HQ admin'}
        </Button>
        <div className="flex items-center justify-between">
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            ← Back
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onForgot}>
            Forgot password?
          </Button>
        </div>
      </form>
    </Card>
  )
}

function AdminSetup({ onBack, onDone }) {
  const auth = useAuth()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (pw.length < 6) return setError('Use at least 6 characters.')
    if (pw !== pw2) return setError('Passwords do not match.')
    setBusy(true)
    try {
      const code = await auth.setupAdmin(pw)
      onDone(code, pw)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-600">Create the admin password for this app.</p>
        <Field label="New admin password" required>
          <TextInput type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        </Field>
        <Field label="Confirm password" required error={error}>
          <TextInput type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </Field>
        <Button full type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Create admin'}
        </Button>
        <Button type="button" variant="ghost" full onClick={onBack}>
          ← Back
        </Button>
      </form>
    </Card>
  )
}

function ForgotPassword({ onBack, onReset }) {
  const auth = useAuth()
  const [code, setCode] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (pw.length < 6) return setError('Use at least 6 characters.')
    if (pw !== pw2) return setError('Passwords do not match.')
    setBusy(true)
    try {
      const newCode = await auth.resetAdminPassword(code, pw)
      onReset(newCode)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-600">
          Enter your recovery code (shown when admin was set up) and choose a new password.
        </p>
        <Field label="Recovery code" required>
          <TextInput
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="XXXX-XXXX-XXXX"
            autoCapitalize="characters"
            className="uppercase tracking-widest"
          />
        </Field>
        <Field label="New password" required>
          <TextInput type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <Field label="Confirm new password" required error={error}>
          <TextInput type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </Field>
        <Button full type="submit" disabled={busy}>
          {busy ? 'Resetting…' : 'Reset password'}
        </Button>
        <Button type="button" variant="ghost" full onClick={onBack}>
          ← Back
        </Button>
      </form>
    </Card>
  )
}

function RecoveryCodeScreen({ code, onContinue }) {
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — user can read it */
    }
  }

  return (
    <Card className="p-5 text-center">
      <h2 className="text-lg font-bold text-slate-800">Save your recovery code</h2>
      <p className="mt-1 text-sm text-slate-500">
        This is the ONLY way to reset the admin password if you forget it. Write it down and keep it
        safe — it won&apos;t be shown again.
      </p>
      <div className="my-5 select-all rounded-xl border-2 border-dashed border-brand bg-brand-light px-4 py-4 text-2xl font-bold tracking-widest text-brand-dark">
        {code}
      </div>
      <Button variant="secondary" full onClick={copy}>
        {copied ? 'Copied ✓' : 'Copy code'}
      </Button>
      <label className="mt-4 flex items-center justify-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I have written it down somewhere safe
      </label>
      <Button
        full
        className="mt-4"
        disabled={!saved || busy}
        onClick={async () => {
          setBusy(true)
          await onContinue()
        }}
      >
        {busy ? 'Please wait…' : 'Continue'}
      </Button>
    </Card>
  )
}
