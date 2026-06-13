import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { getTask, updateTask, deleteTask, listPieceRates, listAreas, listCompanies, listMachines } from '../../db/repo.js'
import { getMeta } from '../../db/database.js'
import { TaskStatus, GpsSource } from '../../db/models.js'
import { toLocalInput, fromLocalInput, formatMoney } from '../../lib/format.js'
import { minutesBetween, formatDuration } from '../../lib/duration.js'
import PageHeader from '../../components/PageHeader.jsx'
import { PhotoById, Lightbox } from '../../components/PhotoThumb.jsx'
import { Button, Card, Field, NumberInput, TextInput, TextArea, Select, Spinner, Badge } from '../../components/ui.jsx'
import { IconTrash } from '../../components/icons.jsx'

export default function EditTask() {
  const { id } = useParams()
  const navigate = useNavigate()

  const task = useLiveQuery(() => getTask(id), [id], undefined)
  const companies = useLiveQuery(() => listCompanies({ includeInactive: true }), [], [])
  const rates = useLiveQuery(() => listPieceRates({ includeInactive: true }), [], [])
  const areas = useLiveQuery(() => listAreas({ includeInactive: true }), [], [])
  const currency = useLiveQuery(() => getMeta('currency', 'RM'), [], 'RM')

  const [f, setF] = useState(null) // form state, initialised from task once
  const [zoom, setZoom] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (task && !f) {
      setF({
        companyId: task.companyId || '',
        machineId: task.machineId || '',
        operatorName: task.operatorName || '',
        status: task.status,
        startTime: toLocalInput(task.startTime),
        startLat: task.startGps?.lat ?? '',
        startLng: task.startGps?.lng ?? '',
        endTime: toLocalInput(task.endTime),
        endLat: task.endGps?.lat ?? '',
        endLng: task.endGps?.lng ?? '',
        rateId: task.pieceRateId || '',
        quantity: task.quantity ?? '',
        areaId: task.areaId || '',
        notes: task.notes || ''
      })
    }
  }, [task, f])

  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))

  const machines = useLiveQuery(
    () => (f?.companyId ? listMachines({ companyId: f.companyId, includeInactive: true }) : Promise.resolve([])),
    [f?.companyId],
    []
  )
  const rate = useMemo(() => (rates || []).find((r) => r.id === f?.rateId) || null, [rates, f?.rateId])
  const durationMins = f ? minutesBetween(fromLocalInput(f.startTime), fromLocalInput(f.endTime)) : null
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

  function gpsFor(latStr, lngStr, original) {
    const lat = latStr === '' ? null : Number(latStr)
    const lng = lngStr === '' ? null : Number(lngStr)
    const changed = lat !== (original?.lat ?? null) || lng !== (original?.lng ?? null)
    return { lat, lng, source: changed ? GpsSource.MANUAL : original?.source || GpsSource.NONE, accuracy: null }
  }

  async function save(e) {
    e.preventDefault()
    setError('')
    const company = (companies || []).find((c) => c.id === f.companyId)
    if (!company) return setError('Choose a company.')
    if (!f.operatorName.trim()) return setError('Enter the operator name.')
    const machine = (machines || []).find((m) => m.id === f.machineId) || null
    const area = (areas || []).find((a) => a.id === f.areaId) || null

    if (f.status === TaskStatus.COMPLETED) {
      if (!f.rateId || f.quantity === '' || !f.endTime) {
        return setError('A completed record needs an end time, piece rate and quantity.')
      }
    }

    const patch = {
      companyId: company.id,
      companyName: company.name,
      machineId: machine?.id ?? null,
      machineName: machine?.name ?? null,
      operatorName: f.operatorName.trim(),
      status: f.status,
      startTime: fromLocalInput(f.startTime),
      startGps: gpsFor(f.startLat, f.startLng, task.startGps),
      endTime: fromLocalInput(f.endTime),
      endGps: gpsFor(f.endLat, f.endLng, task.endGps),
      pieceRateId: rate?.id ?? null,
      pieceRateName: rate?.name ?? null,
      unit: rate?.unit ?? null,
      unitPrice: rate ? Number(rate.price) : null,
      quantity: f.quantity === '' ? null : Number(f.quantity),
      areaId: area?.id ?? null,
      areaName: area?.name ?? null,
      notes: f.notes
    }

    setBusy(true)
    try {
      await updateTask(id, patch)
      navigate('/admin/records')
    } catch (err) {
      setError(err.message || 'Could not save.')
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm('Delete this record permanently? This cannot be undone.')) return
    setBusy(true)
    try {
      await deleteTask(id)
      navigate('/admin/records')
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const hasPhotos = task.startPhotoId || task.workPhotoId || task.endPhotoId

  return (
    <form onSubmit={save} className="pb-4">
      <PageHeader
        title="Edit record"
        subtitle={task.createdBy === 'admin' ? 'Added by admin' : 'From operator'}
        onBack={() => navigate('/admin/records')}
        right={<Badge color={task.status === 'completed' ? 'green' : 'amber'}>{task.status === 'completed' ? 'Completed' : 'Open'}</Badge>}
      />

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
        <Field label="Company" required>
          <Select
            value={f.companyId}
            onChange={(e) => setF((p) => ({ ...p, companyId: e.target.value, machineId: '' }))}
          >
            <option value="">Choose…</option>
            {(companies || []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.active ? '' : ' (inactive)'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Machine">
          <Select value={f.machineId} onChange={set('machineId')} disabled={!f.companyId}>
            <option value="">{f.companyId ? 'None' : 'Pick a company first'}</option>
            {(machines || []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.active ? '' : ' (inactive)'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Operator name" required>
          <TextInput value={f.operatorName} onChange={set('operatorName')} placeholder="e.g. Ahmad" />
        </Field>
        <Field label="Status">
          <Select value={f.status} onChange={set('status')}>
            <option value={TaskStatus.IN_PROGRESS}>Open (in progress)</option>
            <option value={TaskStatus.COMPLETED}>Completed</option>
          </Select>
        </Field>
      </Card>

      <p className="mb-1 mt-4 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Start</p>
      <Card className="space-y-4 p-4">
        <Field label="Start time">
          <TextInput type="datetime-local" step="1" value={f.startTime} onChange={set('startTime')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start latitude">
            <NumberInput value={f.startLat} onChange={set('startLat')} placeholder="e.g. 3.13921" />
          </Field>
          <Field label="Start longitude">
            <NumberInput value={f.startLng} onChange={set('startLng')} placeholder="e.g. 101.6869" />
          </Field>
        </div>
      </Card>

      <p className="mb-1 mt-4 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">End</p>
      <Card className="space-y-4 p-4">
        <Field label="End time">
          <TextInput type="datetime-local" step="1" value={f.endTime} onChange={set('endTime')} />
        </Field>
        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-500">Duration (auto)</span>
          <span className="font-semibold text-slate-800">{durationMins == null ? '—' : formatDuration(durationMins)}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="End latitude">
            <NumberInput value={f.endLat} onChange={set('endLat')} />
          </Field>
          <Field label="End longitude">
            <NumberInput value={f.endLng} onChange={set('endLng')} />
          </Field>
        </div>
      </Card>

      <p className="mb-1 mt-4 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Work</p>
      <Card className="space-y-4 p-4">
        <Field label="Piece rate">
          <Select value={f.rateId} onChange={set('rateId')}>
            <option value="">None</option>
            {(rates || []).map((r) => (
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

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      <div className="mt-4 space-y-2">
        <Button full type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </Button>
        <Button full type="button" variant="danger" onClick={remove} disabled={busy}>
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
