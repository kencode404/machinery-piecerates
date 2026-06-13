import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAuth } from '../../auth/AuthContext.jsx'
import { getMeta, setMeta } from '../../db/database.js'
import { hashSecret } from '../../lib/crypto.js'
import { formatMoney } from '../../lib/format.js'
import {
  listPieceRates,
  upsertPieceRate,
  deletePieceRate,
  listAreas,
  upsertArea,
  deleteArea,
  listCompanies,
  upsertCompany,
  deleteCompany,
  listMachines,
  upsertMachine,
  setMachinePin,
  deleteMachine
} from '../../db/repo.js'
import { Button, Card, Field, TextInput, NumberInput, Select, Modal, Badge } from '../../components/ui.jsx'
import { IconPlus, IconTrash, IconChevron } from '../../components/icons.jsx'

export default function Settings() {
  return (
    <div className="space-y-4 pb-6">
      <h1 className="text-lg font-bold text-slate-800">Settings</h1>
      <GeneralSection />
      <CompaniesSection />
      <MachinesSection />
      <PieceRatesSection />
      <AreasSection />
      <SecuritySection />
      <AboutSection />
    </div>
  )
}

function Section({ title, count, children, action }) {
  const [open, setOpen] = useState(false)
  return (
    <Card className="overflow-hidden">
      <button
        className="flex w-full items-center justify-between px-4 py-3 active:bg-slate-50"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="font-semibold text-slate-800">
          {title}
          {count != null && <span className="ml-2 text-sm font-normal text-slate-400">{count}</span>}
        </span>
        <IconChevron width={18} height={18} className={`text-slate-300 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-slate-100 p-4">
          {children}
          {action && <div className="mt-3">{action}</div>}
        </div>
      )}
    </Card>
  )
}

// Stable React key so each editor remounts (and re-initialises its fields)
// whenever a different item — or "new" — is opened.
const editorKey = (editing) => (editing === 'new' ? 'new' : editing?.id || 'closed')

// ---- General (currency) ---------------------------------------------------

function GeneralSection() {
  const currency = useLiveQuery(() => getMeta('currency', 'RM'), [], 'RM')
  const [value, setValue] = useState(null)
  const v = value ?? currency ?? 'RM'
  const [saved, setSaved] = useState(false)

  async function save() {
    await setMeta('currency', (v || 'RM').trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <Section title="General">
      <Field label="Currency symbol / prefix" hint="Shown before every amount, e.g. RM, $, ₱">
        <TextInput value={v} onChange={(e) => setValue(e.target.value)} maxLength={6} />
      </Field>
      <Button className="mt-3" onClick={save}>
        {saved ? 'Saved ✓' : 'Save'}
      </Button>
    </Section>
  )
}

// ---- Piece rates ----------------------------------------------------------

function PieceRatesSection() {
  const rates = useLiveQuery(() => listPieceRates({ includeInactive: true }), [], [])
  const currency = useLiveQuery(() => getMeta('currency', 'RM'), [], 'RM')
  const [editing, setEditing] = useState(null) // item | 'new' | null

  return (
    <Section
      title="Piece rates"
      count={rates?.length}
      action={
        <Button variant="secondary" full onClick={() => setEditing('new')}>
          <IconPlus width={18} height={18} /> Add piece rate
        </Button>
      }
    >
      <div className="space-y-2">
        {(rates || []).map((r) => (
          <button
            key={r.id}
            onClick={() => setEditing(r)}
            className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 text-left active:bg-slate-50"
          >
            <div>
              <p className="font-medium text-slate-800">
                {r.name} {!r.active && <Badge color="slate">hidden</Badge>}
              </p>
              <p className="text-xs text-slate-400">
                {formatMoney(r.price, currency)} / {r.unit}
              </p>
            </div>
            <IconChevron width={16} height={16} className="text-slate-300" />
          </button>
        ))}
        {rates && rates.length === 0 && <p className="text-sm text-slate-400">No piece rates yet.</p>}
      </div>

      <RateEditor key={editorKey(editing)} editing={editing} onClose={() => setEditing(null)} />
    </Section>
  )
}

function RateEditor({ editing, onClose }) {
  const isNew = editing === 'new'
  const item = isNew ? null : editing
  const open = editing != null
  const [name, setName] = useState(item?.name || '')
  const [unit, setUnit] = useState(item?.unit || '')
  const [price, setPrice] = useState(item?.price ?? '')
  const [active, setActive] = useState(item?.active !== false)

  async function save() {
    if (!name.trim() || !unit.trim()) return
    await upsertPieceRate({ id: item?.id, name, unit, price, active })
    onClose()
  }
  async function remove() {
    if (!confirm(`Delete piece rate "${item.name}"? Existing records keep their saved values.`)) return
    await deletePieceRate(item.id)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={isNew ? 'New piece rate' : 'Edit piece rate'}>
      <div className="space-y-3">
        <Field label="Work name" required>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Repair road" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Unit" required hint="m, m², ton, trip…">
            <TextInput value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="m" />
          </Field>
          <Field label="Price per unit" required>
            <NumberInput value={price} onChange={(e) => setPrice(e.target.value)} placeholder="25" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Show this rate to operators
        </label>
        <Button full onClick={save}>
          Save
        </Button>
        {!isNew && (
          <Button full variant="danger" onClick={remove}>
            <IconTrash width={16} height={16} /> Delete
          </Button>
        )}
      </div>
    </Modal>
  )
}

// ---- Areas ----------------------------------------------------------------

function AreasSection() {
  const areas = useLiveQuery(() => listAreas({ includeInactive: true }), [], [])
  const [editing, setEditing] = useState(null)

  return (
    <Section
      title="Areas"
      count={areas?.length}
      action={
        <Button variant="secondary" full onClick={() => setEditing('new')}>
          <IconPlus width={18} height={18} /> Add area
        </Button>
      }
    >
      <div className="space-y-2">
        {(areas || []).map((a) => (
          <button
            key={a.id}
            onClick={() => setEditing(a)}
            className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 text-left active:bg-slate-50"
          >
            <p className="font-medium text-slate-800">
              {a.name} {!a.active && <Badge color="slate">hidden</Badge>}
            </p>
            <IconChevron width={16} height={16} className="text-slate-300" />
          </button>
        ))}
        {areas && areas.length === 0 && <p className="text-sm text-slate-400">No areas yet.</p>}
      </div>
      <AreaEditor key={editorKey(editing)} editing={editing} onClose={() => setEditing(null)} />
    </Section>
  )
}

function AreaEditor({ editing, onClose }) {
  const isNew = editing === 'new'
  const item = isNew ? null : editing
  const open = editing != null
  const [name, setName] = useState(item?.name || '')
  const [active, setActive] = useState(item?.active !== false)

  async function save() {
    if (!name.trim()) return
    await upsertArea({ id: item?.id, name, active })
    onClose()
  }
  async function remove() {
    if (!confirm(`Delete area "${item.name}"?`)) return
    await deleteArea(item.id)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={isNew ? 'New area' : 'Edit area'}>
      <div className="space-y-3">
        <Field label="Area name" required>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Zone A" autoFocus />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Show this area to operators
        </label>
        <Button full onClick={save}>
          Save
        </Button>
        {!isNew && (
          <Button full variant="danger" onClick={remove}>
            <IconTrash width={16} height={16} /> Delete
          </Button>
        )}
      </div>
    </Modal>
  )
}

// ---- Companies ------------------------------------------------------------

function CompaniesSection() {
  const companies = useLiveQuery(() => listCompanies({ includeInactive: true }), [], [])
  const [editing, setEditing] = useState(null)

  return (
    <Section
      title="Companies"
      count={companies?.length}
      action={
        <Button variant="secondary" full onClick={() => setEditing('new')}>
          <IconPlus width={18} height={18} /> Add company
        </Button>
      }
    >
      <div className="space-y-2">
        {(companies || []).map((c) => (
          <button
            key={c.id}
            onClick={() => setEditing(c)}
            className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 text-left active:bg-slate-50"
          >
            <p className="font-medium text-slate-800">
              {c.name} {!c.active && <Badge color="slate">inactive</Badge>}
            </p>
            <IconChevron width={16} height={16} className="text-slate-300" />
          </button>
        ))}
        {companies && companies.length === 0 && <p className="text-sm text-slate-400">No companies yet.</p>}
      </div>
      <CompanyEditor key={editorKey(editing)} editing={editing} onClose={() => setEditing(null)} />
    </Section>
  )
}

function CompanyEditor({ editing, onClose }) {
  const isNew = editing === 'new'
  const item = isNew ? null : editing
  const open = editing != null
  const [name, setName] = useState(item?.name || '')
  const [active, setActive] = useState(item?.active !== false)

  async function save() {
    if (!name.trim()) return
    await upsertCompany({ id: item?.id, name, active })
    onClose()
  }
  async function remove() {
    if (!confirm(`Delete company "${item.name}"? Its machines and records stay in the system.`)) return
    await deleteCompany(item.id)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={isNew ? 'New company' : 'Edit company'}>
      <div className="space-y-3">
        <Field label="Company name" required>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ABC Construction" autoFocus />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active (operators can log in to it)
        </label>
        <Button full onClick={save}>
          Save
        </Button>
        {!isNew && (
          <Button full variant="danger" onClick={remove}>
            <IconTrash width={16} height={16} /> Delete
          </Button>
        )}
      </div>
    </Modal>
  )
}

// ---- Machines (each has its own login PIN) --------------------------------

function MachinesSection() {
  const machines = useLiveQuery(() => listMachines({ includeInactive: true }), [], [])
  const companies = useLiveQuery(() => listCompanies({ includeInactive: true }), [], [])
  const [editing, setEditing] = useState(null)
  const companyName = (id) => (companies || []).find((c) => c.id === id)?.name || 'No company'

  return (
    <Section
      title="Machines"
      count={machines?.length}
      action={
        <Button variant="secondary" full onClick={() => setEditing('new')}>
          <IconPlus width={18} height={18} /> Add machine
        </Button>
      }
    >
      <div className="space-y-2">
        {(machines || []).map((m) => (
          <button
            key={m.id}
            onClick={() => setEditing(m)}
            className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 text-left active:bg-slate-50"
          >
            <div>
              <p className="font-medium text-slate-800">
                {m.name} {!m.active && <Badge color="slate">inactive</Badge>}
              </p>
              <p className="text-xs text-slate-400">
                {companyName(m.companyId)} · {m.pinHash ? 'PIN set' : 'No PIN — cannot log in'}
              </p>
            </div>
            <IconChevron width={16} height={16} className="text-slate-300" />
          </button>
        ))}
        {machines && machines.length === 0 && <p className="text-sm text-slate-400">No machines yet.</p>}
      </div>
      <MachineEditor
        key={editorKey(editing)}
        editing={editing}
        companies={companies || []}
        onClose={() => setEditing(null)}
      />
    </Section>
  )
}

function MachineEditor({ editing, companies, onClose }) {
  const isNew = editing === 'new'
  const item = isNew ? null : editing
  const open = editing != null
  const [name, setName] = useState(item?.name || '')
  const [companyId, setCompanyId] = useState(item?.companyId || '')
  const [active, setActive] = useState(item?.active !== false)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')

  async function save() {
    if (!companyId) return setError('Choose a company.')
    if (!name.trim()) return setError('Enter a machine name.')
    if (pin && pin.length < 4) return setError('PIN must be at least 4 digits.')
    if (isNew && !pin) return setError('Set a PIN so operators can log in to this machine.')
    const saved = await upsertMachine({ id: item?.id, companyId, name, active })
    if (pin) await setMachinePin(saved.id, await hashSecret(pin))
    onClose()
  }
  async function remove() {
    if (!confirm(`Delete machine "${item.name}"? Its records stay in the system.`)) return
    await deleteMachine(item.id)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={isNew ? 'New machine' : 'Edit machine'}>
      <div className="space-y-3">
        <Field label="Company" required>
          <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">Choose…</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Machine name" required>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Excavator EX-01" />
        </Field>
        <Field
          label={isNew ? 'Login PIN' : 'Reset PIN'}
          required={isNew}
          hint={isNew ? '4+ digits operators type to log in to this machine' : 'Leave blank to keep the current PIN'}
          error={error}
        >
          <TextInput
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="••••"
          />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active (shown at login)
        </label>
        <Button full onClick={save}>
          Save
        </Button>
        {!isNew && (
          <Button full variant="danger" onClick={remove}>
            <IconTrash width={16} height={16} /> Delete
          </Button>
        )}
      </div>
    </Modal>
  )
}

// ---- Security -------------------------------------------------------------

function SecuritySection() {
  const { changeAdminPassword, regenerateRecovery } = useAuth()
  const [old, setOld] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [newCode, setNewCode] = useState('')

  async function change() {
    setErr('')
    setMsg('')
    if (pw.length < 6) return setErr('New password must be at least 6 characters.')
    if (pw !== pw2) return setErr('New passwords do not match.')
    try {
      await changeAdminPassword(old, pw)
      setOld('')
      setPw('')
      setPw2('')
      setMsg('Password changed.')
    } catch (e) {
      setErr(e.message)
    }
  }

  async function regen() {
    if (!confirm('Generate a new recovery code? The old code will stop working.')) return
    const code = await regenerateRecovery()
    setNewCode(code)
  }

  return (
    <Section title="Security">
      <div className="space-y-3">
        <p className="text-sm font-medium text-slate-600">Change admin password</p>
        <Field label="Current password">
          <TextInput type="password" value={old} onChange={(e) => setOld(e.target.value)} />
        </Field>
        <Field label="New password">
          <TextInput type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <Field label="Confirm new password" error={err}>
          <TextInput type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </Field>
        {msg && <p className="text-sm text-green-600">{msg}</p>}
        <Button onClick={change}>Change password</Button>

        <hr className="my-2 border-slate-100" />
        <p className="text-sm font-medium text-slate-600">Recovery code</p>
        <p className="text-xs text-slate-400">
          Used to reset the admin password if it is forgotten. The current code can&apos;t be shown
          again — generate a new one if you&apos;ve lost it.
        </p>
        <Button variant="secondary" onClick={regen}>
          Generate new recovery code
        </Button>
      </div>

      <Modal open={!!newCode} onClose={() => setNewCode('')} title="New recovery code">
        <p className="text-sm text-slate-500">Write this down and keep it safe. It won&apos;t be shown again.</p>
        <div className="my-4 select-all rounded-xl border-2 border-dashed border-brand bg-brand-light px-4 py-4 text-center text-2xl font-bold tracking-widest text-brand-dark">
          {newCode}
        </div>
        <Button full onClick={() => setNewCode('')}>
          Done
        </Button>
      </Modal>
    </Section>
  )
}

function AboutSection() {
  const lastSyncAt = useLiveQuery(() => getMeta('lastSyncAt', null), [], null)
  return (
    <Section title="About & sync">
      <div className="space-y-1 text-sm text-slate-500">
        <p>Machinery Piece Rates · v0.1</p>
        <p>Last successful sync: {lastSyncAt ? new Date(lastSyncAt).toLocaleString() : 'never'}</p>
        <p className="text-xs text-slate-400">
          Records are saved on this device first and sync to the cloud automatically when online.
        </p>
      </div>
    </Section>
  )
}
