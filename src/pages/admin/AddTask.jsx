import { useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { addManualTask, listAreas, listOperators, listMachines, listCompanies, listPieceRates, kerjaJamRate } from '../../db/repo.js'
import { getMeta } from '../../db/database.js'
import { CreatedBy, GpsSource } from '../../db/models.js'
import { fromLocalInput, toLocalInput, formatMoney, formatLatLng, parseLatLng } from '../../lib/format.js'

const geoFor = (loc, fallback) => {
  const { lat, lng } = parseLatLng(loc)
  if (lat == null && lng == null) return fallback || undefined
  const changed = lat !== (fallback?.lat ?? null) || lng !== (fallback?.lng ?? null)
  return { lat, lng, source: changed ? GpsSource.MANUAL : fallback?.source || GpsSource.DEVICE, accuracy: fallback?.accuracy ?? null }
}
import { minutesBetween, formatHours } from '../../lib/duration.js'
import { useAuth } from '../../auth/AuthContext.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import PhotoCapture from '../../components/PhotoCapture.jsx'
import { Button, Card, Field, NumberInput, TextInput, TextArea, Select } from '../../components/ui.jsx'
import { QuantityInput } from '../../components/QuantityInput.jsx'
import { evalExpr, isExpression } from '../../lib/expr.js'

const dateToISO = (d) => (d ? new Date(`${d}T00:00:00`).toISOString() : null)

function computeDuration(f) {
  if (f.durMode === 'time') return minutesBetween(fromLocalInput(f.startTime), fromLocalInput(f.endTime))
  if (f.durMode === 'meter') {
    if (f.startMeter === '' || f.endMeter === '') return null
    const s = Number(f.startMeter)
    const e = Number(f.endMeter)
    if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null
    return Math.round((e - s) * 60)
  }
  if (f.durMode === 'hours') {
    if (f.hours === '') return null
    const h = Number(f.hours)
    if (!Number.isFinite(h) || h < 0) return null
    return Math.round(h * 60)
  }
  return null
}

const DUR_MODES = [
  ['time', 'Start/End'],
  ['meter', 'Hour meter'],
  ['hours', 'Hours']
]

export default function AddTask() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const isSite = user.role === 'siteadmin'
  const [searchParams] = useSearchParams()
  const presetOperatorId = searchParams.get('operator') || '' // set when coming from a record tab
  const presetMonth = searchParams.get('month') || '' // the month tab the admin was viewing

  const operators = useLiveQuery(() => listOperators({ includeInactive: true }), [], [])
  const machines = useLiveQuery(() => listMachines({ includeInactive: true }), [], [])
  const companies = useLiveQuery(() => listCompanies({ includeInactive: true }), [], [])
  const currency = useLiveQuery(() => getMeta('currency', 'RM'), [], 'RM')

  const [f, setF] = useState({
    operatorId: presetOperatorId,
    machineId: '',
    rateId: '',
    quantity: '',
    areaId: '',
    notes: '',
    durMode: 'time',
    startTime: '',
    endTime: '',
    startLoc: '',
    endLoc: '',
    date: '',
    startMeter: '',
    endMeter: '',
    hours: ''
  })
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))
  const [startPhoto, setStartPhoto] = useState(null)
  const [workPhoto, setWorkPhoto] = useState(null)
  const [endPhoto, setEndPhoto] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false)

  // Where the back / Done buttons go — keep the operator's tab AND month in view
  // on return, so several jobs can be added in a row without re-navigating.
  const backToRecords = () => {
    const qs = new URLSearchParams()
    if (presetOperatorId) qs.set('operator', presetOperatorId)
    if (presetMonth) qs.set('month', presetMonth)
    const s = qs.toString()
    navigate(s ? `/admin/records?${s}` : '/admin/records')
  }

  // Operators selectable here: real workers, and (for a site admin) only their company.
  const availableOperators = useMemo(
    () => (operators || []).filter((o) => !o.isSiteAdmin && (!isSite || o.companyId === user.companyId)),
    [operators, isSite, user.companyId]
  )
  const selectedOperator = useMemo(
    () => (operators || []).find((o) => o.id === f.operatorId) || null,
    [operators, f.operatorId]
  )
  // Only the machines ticked for this operator in Settings (their assignment),
  // active and in their company — the same set the operator sees when completing
  // their own work, so an admin entry can't use a machine they aren't assigned.
  const opMachines = useMemo(() => {
    const ids = new Set(selectedOperator?.machineIds || [])
    return (machines || []).filter(
      (m) => m.active && ids.has(m.id) && (!selectedOperator?.companyId || m.companyId === selectedOperator.companyId)
    )
  }, [machines, selectedOperator])
  const areas = useLiveQuery(
    () => (selectedOperator?.companyId ? listAreas({ companyId: selectedOperator.companyId }) : Promise.resolve([])),
    [selectedOperator?.companyId],
    []
  )
  const rates = useLiveQuery(
    () => (f.machineId ? listPieceRates({ machineId: f.machineId }) : Promise.resolve([])),
    [f.machineId],
    []
  )
  // "Kerja jam" (the chosen operator's hourly rate) is offered with the machine's rates.
  const rateOptions = useMemo(
    () => (f.machineId ? [kerjaJamRate(selectedOperator), ...(rates || [])] : []),
    [f.machineId, selectedOperator, rates]
  )
  const rate = useMemo(() => rateOptions.find((r) => r.id === f.rateId) || null, [rateOptions, f.rateId])
  const durationMins = computeDuration(f)
  const qtyNum = evalExpr(f.quantity)
  const amount = rate && qtyNum != null ? qtyNum * Number(rate.price) : null

  // Uploading a photo flips the duration to Start/End mode and fills the time
  // from the photo's EXIF timestamp (its GPS is applied automatically on save).
  function onPhoto(which, photo) {
    if (which === 'start') setStartPhoto(photo)
    else if (which === 'work') setWorkPhoto(photo)
    else setEndPhoto(photo)
    if (!photo) return
    setF((p) => {
      const next = { ...p, durMode: 'time' }
      if (photo.capturedAt) {
        if (which === 'end') next.endTime = toLocalInput(photo.capturedAt)
        else next.startTime = toLocalInput(photo.capturedAt)
      }
      if (photo.gps?.lat != null) {
        const loc = formatLatLng(photo.gps.lat, photo.gps.lng)
        if (which === 'end') next.endLoc = loc
        else next.startLoc = loc
      }
      return next
    })
  }

  async function save(e) {
    e.preventDefault()
    if (submitting.current) return
    setError('')
    const operator = (operators || []).find((o) => o.id === f.operatorId)
    if (!operator) return setError('Choose an operator.')
    const machine = (machines || []).find((m) => m.id === f.machineId)
    if (!machine) return setError('Choose a machine.')
    // Piece rate + quantity are optional; if a quantity is typed it must be > 0.
    if (f.quantity.trim() !== '' && !(evalExpr(f.quantity) > 0)) {
      return setError('Quantity must be a number or sum greater than 0 (e.g. 5+5+10-6).')
    }

    let startTime
    let endTime = null
    let durationMinutes
    let startMileage
    let endMileage

    if (f.durMode === 'time') {
      if (!f.startTime) return setError('Choose a start time.')
      startTime = fromLocalInput(f.startTime)
      endTime = fromLocalInput(f.endTime)
      durationMinutes = undefined // repo derives from times
    } else {
      if (!f.date) return setError('Choose the date of the job.')
      startTime = dateToISO(f.date)
      if (f.durMode === 'meter') {
        if (f.startMeter === '' || f.endMeter === '') return setError('Enter start and end hour-meter readings.')
        if (Number(f.endMeter) < Number(f.startMeter)) return setError('End meter must be at least the start meter.')
        startMileage = f.startMeter
        endMileage = f.endMeter
        durationMinutes = Math.round((Number(f.endMeter) - Number(f.startMeter)) * 60)
      } else {
        if (f.hours === '' || Number(f.hours) <= 0) return setError('Enter the hours worked.')
        durationMinutes = Math.round(Number(f.hours) * 60)
      }
    }

    const company = (companies || []).find((c) => c.id === machine.companyId) || null
    const area = (areas || []).find((a) => a.id === f.areaId) || null

    submitting.current = true
    setBusy(true)
    try {
      await addManualTask({
        operator,
        machine,
        company,
        // Site-admin entries are shown like operator work (green), not "Admin".
        createdBy: isSite ? CreatedBy.SITEADMIN : CreatedBy.ADMIN,
        startTime,
        endTime,
        durationMinutes,
        startMileage,
        endMileage,
        startGps: geoFor(f.startLoc, startPhoto?.gps || workPhoto?.gps),
        endGps: geoFor(f.endLoc, endPhoto?.gps),
        pieceRate: rate,
        quantity: qtyNum,
        quantityExpr: isExpression(f.quantity) ? f.quantity.trim() : null,
        area,
        notes: f.notes,
        startPhoto,
        workPhoto,
        endPhoto
      })
      // Return to records on the SAME operator's tab so several jobs can be
      // added in a row without re-selecting the operator each time.
      backToRecords()
    } catch (err) {
      setError(err.message || 'Could not save.')
      setBusy(false)
      submitting.current = false
    }
  }

  return (
    <form onSubmit={save} className="pb-4">
      <PageHeader title="Add work" subtitle="Manual entry" onBack={backToRecords} />

      <Card className="space-y-4 p-4">
        <Field label="Operator" required>
          {presetOperatorId ? (
            <div className="flex h-12 items-center rounded-xl border border-slate-200 bg-slate-50 px-3.5 font-medium text-slate-800">
              {selectedOperator?.name || '—'}
            </div>
          ) : (
            <Select
              value={f.operatorId}
              onChange={(e) => setF((p) => ({ ...p, operatorId: e.target.value, machineId: '', rateId: '', areaId: '' }))}
            >
              <option value="">Choose…</option>
              {availableOperators.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Machine" required>
          <Select
            value={f.machineId}
            onChange={(e) => setF((p) => ({ ...p, machineId: e.target.value, rateId: '' }))}
            disabled={!f.operatorId}
          >
            <option value="">{f.operatorId ? 'Choose…' : 'Pick an operator first'}</option>
            {opMachines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
          {f.operatorId && opMachines.length === 0 && (
            <p className="mt-1 text-xs text-amber-600">No machines ticked for this operator — assign machines to them in Settings.</p>
          )}
        </Field>
      </Card>

      {/* Duration */}
      <Card className="mt-4 space-y-4 p-4">
        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700">How is the duration set?</p>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
            {DUR_MODES.map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setF((p) => ({ ...p, durMode: val }))}
                className={`rounded-lg py-2 text-sm font-medium transition-colors ${
                  f.durMode === val ? 'bg-white text-brand shadow-sm' : 'text-slate-500'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {f.durMode === 'time' && (
          <>
            <Field label="Start time" required>
              <TextInput type="datetime-local" step="1" value={f.startTime} onChange={set('startTime')} />
            </Field>
            <Field label="Start location" hint="Optional · latitude, longitude">
              <TextInput value={f.startLoc} onChange={set('startLoc')} placeholder="e.g. 3.13921, 101.6869" />
            </Field>
            <Field label="End time">
              <TextInput type="datetime-local" step="1" value={f.endTime} onChange={set('endTime')} />
            </Field>
            <Field label="End location" hint="Optional · latitude, longitude">
              <TextInput value={f.endLoc} onChange={set('endLoc')} placeholder="e.g. 3.13921, 101.6869" />
            </Field>
          </>
        )}

        {f.durMode === 'meter' && (
          <>
            <Field label="Tarikh kerja" required>
              <TextInput type="date" value={f.date} onChange={set('date')} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start meter (hrs)" required>
                <NumberInput value={f.startMeter} onChange={set('startMeter')} placeholder="e.g. 1240.5" />
              </Field>
              <Field label="End meter (hrs)" required>
                <NumberInput value={f.endMeter} onChange={set('endMeter')} placeholder="e.g. 1243.0" />
              </Field>
            </div>
          </>
        )}

        {f.durMode === 'hours' && (
          <>
            <Field label="Tarikh kerja" required>
              <TextInput type="date" value={f.date} onChange={set('date')} />
            </Field>
            <Field label="Jam bekerja" required hint="To 1 decimal, e.g. 2.5">
              <NumberInput value={f.hours} onChange={set('hours')} placeholder="e.g. 2.5" step="0.1" />
            </Field>
          </>
        )}

        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-500">Duration (auto)</span>
          <span className="font-semibold text-slate-800">{durationMins == null ? '—' : formatHours(durationMins)}</span>
        </div>
      </Card>

      {/* Work */}
      <Card className="mt-4 space-y-4 p-4">
        <Field label="Piece rate work" hint={f.machineId ? 'Optional' : 'Choose a machine first'}>
          <Select value={f.rateId} onChange={set('rateId')} disabled={!f.machineId}>
            <option value="">{f.machineId ? 'Choose work type…' : 'Pick a machine first'}</option>
            {rateOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} — {formatMoney(r.price, currency)}/{r.unit}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Quantity${rate ? ` (${rate.unit})` : ''}`} hint="Optional — a number or a sum like 5+5+10-6">
          <QuantityInput value={f.quantity} onChange={(v) => setF((p) => ({ ...p, quantity: v }))} />
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

      {/* Optional photos — small compact 3-up box */}
      <Card className="mt-4 p-4">
        <p className="mb-1 text-sm font-medium text-slate-700">
          Photos<span className="text-slate-400"> (optional)</span>
        </p>
        <p className="mb-2 text-xs text-slate-400">A photo sets Start/End mode and fills the time + GPS.</p>
        <div className="grid grid-cols-3 gap-2">
          <PhotoCapture compact label="Start" value={startPhoto} onChange={(p) => onPhoto('start', p)} />
          <PhotoCapture compact label="Work" value={workPhoto} onChange={(p) => onPhoto('work', p)} />
          <PhotoCapture compact label="End" value={endPhoto} onChange={(p) => onPhoto('end', p)} />
        </div>
      </Card>

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      <Button full type="submit" className="mt-4" disabled={busy}>
        {busy ? 'Saving…' : 'Add record'}
      </Button>
    </form>
  )
}
