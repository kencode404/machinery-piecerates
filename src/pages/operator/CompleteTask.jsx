import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAuth } from '../../auth/AuthContext.jsx'
import {
  getTask,
  completeTask,
  listPieceRates,
  listAreas,
  listOperatorMachines,
  listCompanies,
  getOperator,
  kerjaJamRate
} from '../../db/repo.js'
import { TaskStatus, GpsSource } from '../../db/models.js'
import { minutesBetween, formatHours } from '../../lib/duration.js'
import { timeOf, dateTimeOf, formatMoney, toLocalInput, fromLocalInput, formatLatLng, parseLatLng } from '../../lib/format.js'

const geoFor = (loc, fallback) => {
  const { lat, lng } = parseLatLng(loc)
  if (lat == null && lng == null) return fallback || undefined
  const changed = lat !== (fallback?.lat ?? null) || lng !== (fallback?.lng ?? null)
  return { lat, lng, source: changed ? GpsSource.MANUAL : fallback?.source || GpsSource.DEVICE, accuracy: fallback?.accuracy ?? null }
}
import { getMeta } from '../../db/database.js'
import PhotoCapture from '../../components/PhotoCapture.jsx'
import { PhotoById } from '../../components/PhotoThumb.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import { Button, Card, Field, NumberInput, TextInput, TextArea, Select, Spinner } from '../../components/ui.jsx'

export default function CompleteTask() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const task = useLiveQuery(() => getTask(id), [id], undefined)
  const machines = useLiveQuery(() => listOperatorMachines(user.operatorId), [user.operatorId], [])
  const operator = useLiveQuery(() => getOperator(user.operatorId), [user.operatorId], null)
  const companies = useLiveQuery(() => listCompanies({ includeInactive: true }), [], [])
  const areas = useLiveQuery(() => listAreas({ companyId: user.companyId }), [user.companyId], [])
  const currency = useLiveQuery(() => getMeta('currency', 'RM'), [], 'RM')

  const [endPhoto, setEndPhoto] = useState(null)
  const [endTime, setEndTime] = useState('')
  const [timeTouched, setTimeTouched] = useState(false)
  const [endLoc, setEndLoc] = useState('')
  const [locTouched, setLocTouched] = useState(false)
  const [machineId, setMachineId] = useState('')
  const [rateId, setRateId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [areaId, setAreaId] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false)

  // Piece rates belong to the chosen machine.
  const rates = useLiveQuery(
    () => (machineId ? listPieceRates({ machineId }) : Promise.resolve([])),
    [machineId],
    []
  )

  const suggested = endPhoto?.capturedAt || null
  useEffect(() => {
    if (!timeTouched && suggested) setEndTime(toLocalInput(suggested))
  }, [suggested, timeTouched])

  // Pre-fill the location from the end photo's GPS, until edited by hand.
  useEffect(() => {
    if (locTouched) return
    if (endPhoto?.gps?.lat != null) setEndLoc(formatLatLng(endPhoto.gps.lat, endPhoto.gps.lng))
  }, [endPhoto, locTouched])

  const machine = useMemo(() => (machines || []).find((m) => m.id === machineId) || null, [machines, machineId])
  const company = useMemo(
    () => (companies || []).find((c) => c.id === machine?.companyId) || null,
    [companies, machine]
  )
  // "Kerja jam" (operator hourly rate) is offered alongside the machine's rates.
  const rateOptions = useMemo(
    () => (machineId ? [kerjaJamRate(operator), ...(rates || [])] : []),
    [machineId, operator, rates]
  )
  const rate = useMemo(() => rateOptions.find((r) => r.id === rateId) || null, [rateOptions, rateId])
  const area = useMemo(() => (areas || []).find((a) => a.id === areaId) || null, [areas, areaId])

  const endISO = fromLocalInput(endTime)
  const durationMins = task ? minutesBetween(task.startTime, endISO) : null
  const amount = rate && quantity !== '' ? Number(quantity) * Number(rate.price) : null

  if (task === undefined) {
    return (
      <div className="flex justify-center py-20 text-brand">
        <Spinner className="h-7 w-7" />
      </div>
    )
  }
  if (!task || task.status === TaskStatus.COMPLETED) {
    return (
      <div className="py-10 text-center text-slate-500">
        <p>This task is not open.</p>
        <Button className="mt-4" onClick={() => navigate('/open')}>
          Back to open tasks
        </Button>
      </div>
    )
  }

  // Piece rate + quantity are optional. Everything else is still required.
  const canSave = endPhoto && endTime && machineId && areaId

  async function submit(e) {
    e.preventDefault()
    if (submitting.current) return
    setError('')
    if (!canSave) {
      setError('Add the end photo, end time, machine and area.')
      return
    }
    if (durationMins == null) {
      setError('The end time is before the start time. Adjust the end time.')
      return
    }
    submitting.current = true
    setBusy(true)
    try {
      await completeTask(id, {
        endTime: endISO,
        endPhoto,
        endGps: geoFor(endLoc, endPhoto?.gps),
        machine,
        company,
        pieceRate: rate,
        quantity,
        area,
        notes
      })
      navigate('/summary')
    } catch (err) {
      setError(err.message || 'Could not save.')
      setBusy(false)
      submitting.current = false
    }
  }

  return (
    <form onSubmit={submit} className="pb-4">
      <PageHeader title="Finish task" subtitle={`Started ${dateTimeOf(task.startTime)}`} onBack={() => navigate('/open')} />

      {/* Reference: the two start photos */}
      <Card className="mb-4 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Start of task</p>
        <div className="flex gap-2">
          <div className="flex-1">
            <PhotoById id={task.startPhotoId} className="aspect-square w-full" />
            <p className="mt-1 text-center text-[11px] text-slate-400">Photo 1</p>
          </div>
          <div className="flex-1">
            <PhotoById id={task.workPhotoId} className="aspect-square w-full" />
            <p className="mt-1 text-center text-[11px] text-slate-400">Photo 2 · {timeOf(task.startTime)}</p>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        <PhotoCapture label="End photo" required hint="Proof the work is finished" value={endPhoto} onChange={setEndPhoto} />

        <Card className="space-y-4 p-4">
          <Field label="End time" required hint="Taken from the photo — edit if needed">
            <TextInput
              type="datetime-local"
              step="1"
              value={endTime}
              onChange={(e) => {
                setTimeTouched(true)
                setEndTime(e.target.value)
              }}
            />
          </Field>
          <Field label="End location" hint="From the photo — edit if needed (latitude, longitude)">
            <TextInput
              value={endLoc}
              onChange={(e) => {
                setLocTouched(true)
                setEndLoc(e.target.value)
              }}
              placeholder="e.g. 3.13921, 101.6869"
            />
          </Field>
          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
            <span className="text-sm text-slate-500">Duration (auto)</span>
            <span className="text-lg font-bold text-slate-800">
              {formatHours(durationMins)}
            </span>
          </div>
        </Card>

        <Card className="space-y-4 p-4">
          <Field label="Machine used" required>
            <Select
              value={machineId}
              onChange={(e) => {
                setMachineId(e.target.value)
                setRateId('') // rates depend on the machine
              }}
            >
              <option value="">Choose machine…</option>
              {(machines || []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
            {machines && machines.length === 0 && (
              <p className="mt-1 text-xs text-red-500">No machines assigned to you. Ask your admin.</p>
            )}
          </Field>

          <Field label="Piece rate work" hint={machineId ? 'Optional — leave blank if not known yet' : 'Choose a machine first'}>
            <Select value={rateId} onChange={(e) => setRateId(e.target.value)} disabled={!machineId}>
              <option value="">{machineId ? 'Choose work type…' : 'Pick a machine first'}</option>
              {rateOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} — {formatMoney(r.price, currency)}/{r.unit}
                </option>
              ))}
            </Select>
            {machineId && rates && rates.length === 0 && (
              <p className="mt-1 text-xs text-red-500">This machine has no piece rates yet. Ask your admin.</p>
            )}
          </Field>

          <Field label={`Quantity${rate ? ` (${rate.unit})` : ''}`} hint="Optional — units of work done">
            <NumberInput value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="e.g. 3" />
          </Field>

          <Field label="Area" required>
            <Select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
              <option value="">Choose area…</option>
              {(areas || []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Notes (optional)">
            <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </Card>

        {amount != null && (
          <Card className="flex items-center justify-between bg-brand-light p-4">
            <span className="text-sm text-brand-dark">Total amount</span>
            <span className="text-xl font-bold text-brand-dark">{formatMoney(amount, currency)}</span>
          </Card>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <Button full type="submit" disabled={busy || !canSave}>
          {busy ? 'Saving…' : 'Complete task'}
        </Button>
      </div>
    </form>
  )
}
