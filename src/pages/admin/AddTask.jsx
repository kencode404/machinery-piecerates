import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { addManualTask, listPieceRates, listAreas, listCompanies, listMachines } from '../../db/repo.js'
import { getMeta } from '../../db/database.js'
import { GpsSource } from '../../db/models.js'
import { fromLocalInput, formatMoney } from '../../lib/format.js'
import { minutesBetween, formatDuration } from '../../lib/duration.js'
import PageHeader from '../../components/PageHeader.jsx'
import { Button, Card, Field, NumberInput, TextInput, TextArea, Select } from '../../components/ui.jsx'

export default function AddTask() {
  const navigate = useNavigate()
  const companies = useLiveQuery(() => listCompanies({ includeInactive: true }), [], [])
  const rates = useLiveQuery(() => listPieceRates(), [], [])
  const areas = useLiveQuery(() => listAreas(), [], [])
  const currency = useLiveQuery(() => getMeta('currency', 'RM'), [], 'RM')

  const [f, setF] = useState({
    companyId: '',
    machineId: '',
    operatorName: '',
    startTime: '',
    endTime: '',
    startLat: '',
    startLng: '',
    rateId: '',
    quantity: '',
    areaId: '',
    notes: ''
  })
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const machines = useLiveQuery(
    () => (f.companyId ? listMachines({ companyId: f.companyId, includeInactive: true }) : Promise.resolve([])),
    [f.companyId],
    []
  )
  const rate = useMemo(() => (rates || []).find((r) => r.id === f.rateId) || null, [rates, f.rateId])
  const durationMins = minutesBetween(fromLocalInput(f.startTime), fromLocalInput(f.endTime))
  const amount = rate && f.quantity !== '' ? Number(f.quantity) * Number(rate.price) : null

  async function save(e) {
    e.preventDefault()
    setError('')
    const company = (companies || []).find((c) => c.id === f.companyId)
    if (!company) return setError('Choose a company.')
    if (!f.operatorName.trim()) return setError('Enter the operator name.')
    if (!f.startTime) return setError('Choose a start time.')
    if (!f.rateId || f.quantity === '' || Number(f.quantity) <= 0) {
      return setError('Choose a piece rate and a quantity.')
    }
    const machine = (machines || []).find((m) => m.id === f.machineId) || null
    const area = (areas || []).find((a) => a.id === f.areaId) || null

    setBusy(true)
    try {
      await addManualTask({
        company,
        machine,
        operatorName: f.operatorName,
        startTime: fromLocalInput(f.startTime),
        endTime: fromLocalInput(f.endTime),
        startGps:
          f.startLat !== '' && f.startLng !== ''
            ? { lat: Number(f.startLat), lng: Number(f.startLng), source: GpsSource.MANUAL, accuracy: null }
            : null,
        pieceRate: rate,
        quantity: f.quantity,
        area,
        notes: f.notes
      })
      navigate('/admin/records')
    } catch (err) {
      setError(err.message || 'Could not save.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="pb-4">
      <PageHeader title="Add work" subtitle="Manual entry — no photos needed" onBack={() => navigate('/admin/records')} />

      <Card className="space-y-4 p-4">
        <Field label="Company" required>
          <Select
            value={f.companyId}
            onChange={(e) => setF((p) => ({ ...p, companyId: e.target.value, machineId: '' }))}
          >
            <option value="">Choose…</option>
            {(companies || []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Machine">
          <Select value={f.machineId} onChange={set('machineId')} disabled={!f.companyId}>
            <option value="">{f.companyId ? 'Choose…' : 'Pick a company first'}</option>
            {(machines || []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Operator name" required hint="Shown on the salary claim">
          <TextInput value={f.operatorName} onChange={set('operatorName')} placeholder="e.g. Ahmad" />
        </Field>
        <div className="grid grid-cols-1 gap-3">
          <Field label="Start time" required>
            <TextInput type="datetime-local" step="1" value={f.startTime} onChange={set('startTime')} />
          </Field>
          <Field label="End time">
            <TextInput type="datetime-local" step="1" value={f.endTime} onChange={set('endTime')} />
          </Field>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-500">Duration (auto)</span>
          <span className="font-semibold text-slate-800">{durationMins == null ? '—' : formatDuration(durationMins)}</span>
        </div>
      </Card>

      <Card className="mt-4 space-y-4 p-4">
        <Field label="Piece rate work" required>
          <Select value={f.rateId} onChange={set('rateId')}>
            <option value="">Choose work type…</option>
            {(rates || []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} — {formatMoney(r.price, currency)}/{r.unit}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Quantity${rate ? ` (${rate.unit})` : ''}`} required>
          <NumberInput value={f.quantity} onChange={set('quantity')} />
        </Field>
        <Field label="Area">
          <Select value={f.areaId} onChange={set('areaId')}>
            <option value="">Choose area…</option>
            {(areas || []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes (optional)">
          <TextArea value={f.notes} onChange={set('notes')} />
        </Field>
        {amount != null && (
          <div className="flex items-center justify-between rounded-lg bg-brand-light px-3 py-2">
            <span className="text-sm text-brand-dark">Amount</span>
            <span className="font-bold text-brand-dark">{formatMoney(amount, currency)}</span>
          </div>
        )}
      </Card>

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      <Button full type="submit" className="mt-4" disabled={busy}>
        {busy ? 'Saving…' : 'Add record'}
      </Button>
    </form>
  )
}
