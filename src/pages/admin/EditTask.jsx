import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  getTask,
  updateTask,
  deleteTask,
  listPieceRates,
  listAreas,
  listOperators,
  listMachines,
  listCompanies,
  isMonthLocked,
  kerjaJamRate,
  KERJA_JAM_ID
} from '../../db/repo.js'
import { getMeta } from '../../db/database.js'
import { TaskStatus, GpsSource, HOURLY_RATE_NAME } from '../../db/models.js'
import { toLocalInput, fromLocalInput, formatMoney, dayKeyOf, monthKeyOf, formatLatLng, parseLatLng } from '../../lib/format.js'
import { minutesBetween, formatHours } from '../../lib/duration.js'
import { useAuth } from '../../auth/AuthContext.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import { PhotoById, Lightbox } from '../../components/PhotoThumb.jsx'
import PhotoCapture from '../../components/PhotoCapture.jsx'
import { Button, Card, Field, NumberInput, TextInput, TextArea, Select, Spinner, Badge } from '../../components/ui.jsx'
import { IconTrash, IconLock } from '../../components/icons.jsx'

const DUR_MODES = [
  ['time', 'Start/End'],
  ['meter', 'Hour meter'],
  ['hours', 'Hours']
]

const dateToISO = (d) => (d ? new Date(`${d}T00:00:00`).toISOString() : null)

function computeDur(f) {
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

export default function EditTask() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isSite = user.role === 'siteadmin'

  const task = useLiveQuery(() => getTask(id), [id], undefined)
  const operators = useLiveQuery(() => listOperators({ includeInactive: true }), [], [])
  const machines = useLiveQuery(() => listMachines({ includeInactive: true }), [], [])
  const companies = useLiveQuery(() => listCompanies({ includeInactive: true }), [], [])
  const currency = useLiveQuery(() => getMeta('currency', 'RM'), [], 'RM')
  const locked = useLiveQuery(() => isMonthLocked(task?.monthKey), [task?.monthKey], false)

  const [f, setF] = useState(null)
  const [zoom, setZoom] = useState(null)
  const [startPhoto, setStartPhoto] = useState(null)
  const [workPhoto, setWorkPhoto] = useState(null)
  const [endPhoto, setEndPhoto] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false)

  useEffect(() => {
    if (task && !f) {
      // Infer how the duration was originally entered so the matching mode opens.
      const durMode = task.endTime
        ? 'time'
        : task.startMileage != null && task.endMileage != null
          ? 'meter'
          : task.durationMinutes != null
            ? 'hours'
            : 'time'
      setF({
        operatorId: task.operatorId || '',
        machineId: task.machineId || '',
        status: task.status,
        durMode,
        startTime: toLocalInput(task.startTime),
        date: task.startTime ? dayKeyOf(task.startTime) : '',
        startLoc: formatLatLng(task.startGps?.lat, task.startGps?.lng),
        endTime: toLocalInput(task.endTime),
        endLoc: formatLatLng(task.endGps?.lat, task.endGps?.lng),
        startMeter: task.startMileage ?? '',
        endMeter: task.endMileage ?? '',
        hours: task.durationMinutes != null ? String(+(task.durationMinutes / 60).toFixed(2)) : '',
        rateId: task.pieceRateId || (task.pieceRateName === HOURLY_RATE_NAME ? KERJA_JAM_ID : ''),
        quantity: task.quantity ?? '',
        areaId: task.areaId || '',
        notes: task.notes || ''
      })
    }
  }, [task, f])

  // A site admin may only edit records in their own company.
  useEffect(() => {
    if (isSite && task && task.companyId && task.companyId !== user.companyId) {
      navigate('/admin/records', { replace: true })
    }
  }, [isSite, task, user.companyId, navigate])

  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))

  // Return to the records list with the operator tab + month still selected, so
  // the admin keeps editing that operator in place (no jump to the first one).
  const backToRecords = (operatorId, monthKey) => {
    const qs = new URLSearchParams()
    if (operatorId) qs.set('operator', operatorId)
    if (monthKey) qs.set('month', monthKey)
    const s = qs.toString()
    navigate(s ? `/admin/records?${s}` : '/admin/records')
  }

  const availableOperators = useMemo(
    () => (operators || []).filter((o) => !o.isSiteAdmin && (!isSite || o.companyId === user.companyId)),
    [operators, isSite, user.companyId]
  )

  const rates = useLiveQuery(
    () => (f?.machineId ? listPieceRates({ machineId: f.machineId, includeInactive: true }) : Promise.resolve([])),
    [f?.machineId],
    []
  )
  const selectedOperator = useMemo(
    () => (operators || []).find((o) => o.id === f?.operatorId) || null,
    [operators, f?.operatorId]
  )
  // "Kerja jam" (the operator's hourly rate) is offered with the machine's rates.
  const rateOptions = useMemo(
    () => (f?.machineId ? [kerjaJamRate(selectedOperator), ...(rates || [])] : []),
    [f?.machineId, selectedOperator, rates]
  )
  const rate = useMemo(() => rateOptions.find((r) => r.id === f?.rateId) || null, [rateOptions, f?.rateId])
  const opMachines = useMemo(
    () => (machines || []).filter((m) => m.companyId === selectedOperator?.companyId),
    [machines, selectedOperator]
  )
  const areas = useLiveQuery(
    () =>
      selectedOperator?.companyId
        ? listAreas({ companyId: selectedOperator.companyId, includeInactive: true })
        : Promise.resolve([]),
    [selectedOperator?.companyId],
    []
  )
  const durationMins = f ? computeDur(f) : null
  const amount = rate && f?.quantity !== '' ? Number(f.quantity) * Number(rate.price) : null

  if (task === undefined || !f) {
    return (
      <div className="flex justify-center py-20 text-brand">
        <Spinner className="h-7 w-7" />
      </div>
    )
  }
  if (!task) {
    return (
      <div className="py-10 text-center text-slate-500">
        <p>Record not found.</p>
        <Button className="mt-4" onClick={() => navigate('/admin/records')}>
          Back to records
        </Button>
      </div>
    )
  }

  function gpsFor(loc, original) {
    const { lat, lng } = parseLatLng(loc)
    const changed = lat !== (original?.lat ?? null) || lng !== (original?.lng ?? null)
    return { lat, lng, source: changed ? GpsSource.MANUAL : original?.source || GpsSource.NONE, accuracy: null }
  }

  // Uploading a photo flips to Start/End mode and fills the time + location.
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
    const machine = (machines || []).find((m) => m.id === f.machineId) || null
    const company = (companies || []).find((c) => c.id === machine?.companyId) || null
    const area = (areas || []).find((a) => a.id === f.areaId) || null

    // Duration + start anchor come from the chosen mode.
    if (f.durMode === 'time' && !f.startTime) return setError('Choose a start time.')
    if (f.durMode !== 'time' && !f.date) return setError('Choose the date of the job.')
    const durationMinutes = computeDur(f)
    const startTime = f.durMode === 'time' ? fromLocalInput(f.startTime) : dateToISO(f.date)
    const endTime = f.durMode === 'time' ? fromLocalInput(f.endTime) : null
    const startMileage = f.durMode === 'meter' && f.startMeter !== '' ? Number(f.startMeter) : null
    const endMileage = f.durMode === 'meter' && f.endMeter !== '' ? Number(f.endMeter) : null

    // Piece rate + quantity are optional; a completed record still needs the rest.
    if (f.status === TaskStatus.COMPLETED) {
      if (!machine) return setError('A completed record needs a machine.')
      if (durationMinutes == null) {
        return setError('Enter the duration (end time, hour meter, or hours).')
      }
      if (f.quantity !== '' && Number(f.quantity) <= 0) {
        return setError('Quantity must be more than 0.')
      }
    }

    const patch = {
      operatorId: operator.id,
      operatorName: operator.name,
      machineId: machine?.id ?? null,
      machineName: machine?.name ?? null,
      companyId: company?.id ?? machine?.companyId ?? null,
      companyName: company?.name ?? null,
      status: f.status,
      startTime,
      startGps: gpsFor(f.startLoc, task.startGps),
      endTime,
      endGps: gpsFor(f.endLoc, task.endGps),
      startMileage,
      endMileage,
      durationMinutes,
      pieceRateId: rate?.id ?? null,
      pieceRateName: rate?.name ?? null,
      unit: rate?.unit ?? null,
      unitPrice: rate ? Number(rate.price) : null,
      quantity: f.quantity === '' ? null : Number(f.quantity),
      areaId: area?.id ?? null,
      areaName: area?.name ?? null,
      notes: f.notes
    }

    submitting.current = true
    setBusy(true)
    try {
      await updateTask(id, patch, { startPhoto, workPhoto, endPhoto })
      // Follow the record to where it now lives — the operator and/or month may
      // have been changed in this edit — instead of snapping to the first operator.
      backToRecords(f.operatorId, startTime ? monthKeyOf(startTime) : task.monthKey)
    } catch (err) {
      setError(err.message || 'Could not save.')
      setBusy(false)
      submitting.current = false
    }
  }

  async function remove() {
    if (submitting.current) return
    if (!confirm('Delete this record permanently? This cannot be undone.')) return
    submitting.current = true
    setBusy(true)
    try {
      await deleteTask(id)
      backToRecords(task.operatorId, task.monthKey)
    } catch (err) {
      setError(err.message)
      setBusy(false)
      submitting.current = false
    }
  }

  const hasPhotos = task.startPhotoId || task.workPhotoId || task.endPhotoId

  return (
    <form onSubmit={save} className="pb-4">
      <PageHeader
        title="Edit record"
        subtitle={
          task.createdBy === 'admin'
            ? 'Added by HQ admin'
            : task.createdBy === 'siteadmin'
              ? 'Added by site admin'
              : 'From operator'
        }
        onBack={() => backToRecords(task.operatorId, task.monthKey)}
        right={<Badge color={task.status === 'completed' ? 'green' : 'amber'}>{task.status === 'completed' ? 'Completed' : 'Open'}</Badge>}
      />

      {locked && (
        <div className="mb-4 flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700">
          <IconLock width={16} height={16} /> This month is locked. Unlock it in Payroll to edit or delete this record.
        </div>
      )}

      {hasPhotos && (
        <Card className="mb-4 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Photos</p>
          <div className="grid grid-cols-3 gap-2">
            <PhotoFigure id={task.startPhotoId} label="Start" onZoom={setZoom} />
            <PhotoFigure id={task.workPhotoId} label="Work" onZoom={setZoom} />
            <PhotoFigure id={task.endPhotoId} label="End" onZoom={setZoom} />
          </div>
        </Card>
      )}

      <Card className="space-y-4 p-4">
        <Field label="Operator" required>
          <Select
            value={f.operatorId}
            onChange={(e) => setF((p) => ({ ...p, operatorId: e.target.value, machineId: '', rateId: '', areaId: '' }))}
          >
            <option value="">Choose…</option>
            {availableOperators.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.active ? '' : ' (inactive)'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Machine">
          <Select
            value={f.machineId}
            onChange={(e) => setF((p) => ({ ...p, machineId: e.target.value, rateId: '' }))}
            disabled={!f.operatorId}
          >
            <option value="">{f.operatorId ? 'None' : 'Pick an operator first'}</option>
            {opMachines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.active ? '' : ' (inactive)'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={f.status} onChange={set('status')}>
            <option value={TaskStatus.IN_PROGRESS}>Open (in progress)</option>
            <option value={TaskStatus.COMPLETED}>Completed</option>
          </Select>
        </Field>
      </Card>

      <p className="mb-1 mt-4 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Duration</p>
      <Card className="space-y-4 p-4">
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
            <Field label="Start time">
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
            <Field label="Tarikh kerja">
              <TextInput type="date" value={f.date} onChange={set('date')} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start meter (hrs)">
                <NumberInput value={f.startMeter} onChange={set('startMeter')} placeholder="e.g. 1240.5" />
              </Field>
              <Field label="End meter (hrs)">
                <NumberInput value={f.endMeter} onChange={set('endMeter')} placeholder="e.g. 1243.0" />
              </Field>
            </div>
          </>
        )}

        {f.durMode === 'hours' && (
          <>
            <Field label="Tarikh kerja">
              <TextInput type="date" value={f.date} onChange={set('date')} />
            </Field>
            <Field label="Jam bekerja" hint="To 1 decimal, e.g. 2.5">
              <NumberInput value={f.hours} onChange={set('hours')} placeholder="e.g. 2.5" step="0.1" />
            </Field>
          </>
        )}

        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-500">Duration (auto)</span>
          <span className="font-semibold text-slate-800">{formatHours(durationMins)}</span>
        </div>
      </Card>

      <p className="mb-1 mt-4 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Work</p>
      <Card className="space-y-4 p-4">
        <Field label="Piece rate" hint={f.machineId ? undefined : 'Choose a machine first'}>
          <Select value={f.rateId} onChange={set('rateId')} disabled={!f.machineId}>
            <option value="">None</option>
            {rateOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} — {formatMoney(r.price, currency)}/{r.unit}
                {r.active ? '' : ' (inactive)'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Quantity${rate ? ` (${rate.unit})` : ''}`}>
          <NumberInput value={f.quantity} onChange={set('quantity')} />
        </Field>
        <Field label="Area">
          <Select value={f.areaId} onChange={set('areaId')}>
            <option value="">None</option>
            {(areas || []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.active ? '' : ' (inactive)'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes">
          <TextArea value={f.notes} onChange={set('notes')} />
        </Field>
        {amount != null && (
          <div className="flex items-center justify-between rounded-lg bg-brand-light px-3 py-2">
            <span className="text-sm text-brand-dark">Amount</span>
            <span className="font-bold text-brand-dark">{formatMoney(amount, currency)}</span>
          </div>
        )}
      </Card>

      <Card className="mt-4 p-4">
        <p className="mb-1 text-sm font-medium text-slate-700">
          {hasPhotos ? 'Replace photos' : 'Add photos'}
          <span className="text-slate-400"> (optional)</span>
        </p>
        <p className="mb-2 text-xs text-slate-400">A photo sets Start/End mode and fills the time + location.</p>
        <div className="grid grid-cols-3 gap-2">
          <PhotoCapture compact label="Start" value={startPhoto} onChange={(p) => onPhoto('start', p)} />
          <PhotoCapture compact label="Work" value={workPhoto} onChange={(p) => onPhoto('work', p)} />
          <PhotoCapture compact label="End" value={endPhoto} onChange={(p) => onPhoto('end', p)} />
        </div>
      </Card>

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      <div className="mt-4 space-y-2">
        <Button full type="submit" disabled={busy || locked}>
          {busy ? 'Saving…' : locked ? 'Locked' : 'Save changes'}
        </Button>
        <Button full type="button" variant="danger" onClick={remove} disabled={busy || locked}>
          <IconTrash width={18} height={18} /> Delete record
        </Button>
      </div>

      <Lightbox url={zoom} onClose={() => setZoom(null)} />
    </form>
  )
}

function PhotoFigure({ id, label, onZoom }) {
  if (!id) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-lg bg-slate-100 text-[10px] text-slate-300">
        No {label}
      </div>
    )
  }
  return (
    <div>
      <PhotoById id={id} className="aspect-square w-full" onZoom={onZoom} />
      <p className="mt-1 text-center text-[10px] text-slate-400">{label}</p>
    </div>
  )
}
