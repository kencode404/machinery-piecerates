import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAuth } from '../../auth/AuthContext.jsx'
import {
  getTask,
  getPhoto,
  completeTask,
  saveTaskProgress,
  deleteTask,
  listPieceRates,
  listAreas,
  listOperatorMachines,
  listCompanies,
  getOperator,
  kerjaJamRate,
  listTaskTracks
} from '../../db/repo.js'
import { isDistanceUnit } from '../../lib/dashboard.js'

// Code-split: Leaflet only loads when an operator actually opens the map.
const DistanceRecorder = lazy(() => import('../../components/DistanceRecorder.jsx'))
import { TaskStatus, GpsSource } from '../../db/models.js'
import { minutesBetween, formatHours } from '../../lib/duration.js'
import { timeOf, dateTimeOf, formatMoney, formatRate, toLocalInput, fromLocalInput, formatLatLng, parseLatLng } from '../../lib/format.js'
import { QuantityInput } from '../../components/QuantityInput.jsx'
import { evalExpr, isExpression } from '../../lib/expr.js'
import { requestSync } from '../../sync/syncEngine.js'

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

  const [endWorkPhoto, setEndWorkPhoto] = useState(null)
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
  const [mapOpen, setMapOpen] = useState(false)
  const submitting = useRef(false)
  const hydrated = useRef(false)
  const rateHydrated = useRef(false)
  const finalizing = useRef(false) // true once completing/deleting — stop auto-save
  const savedWork = useRef(null) // end-work photo object already persisted
  const savedMeter = useRef(null) // end-meter photo object already persisted
  const removedWork = useRef(false) // operator cleared the proof-of-work photo
  const removedMeter = useRef(false) // operator cleared the ending-meter photo

  // Photo handlers that also record an explicit "cleared" flag, so a removal is
  // persisted (and can't misfire during hydration, which sets the photo directly).
  const onEndWorkPhoto = (p) => {
    setEndWorkPhoto(p)
    removedWork.current = !p
  }
  const onEndPhoto = (p) => {
    setEndPhoto(p)
    removedMeter.current = !p
  }

  // Piece rates belong to the chosen machine.
  const rates = useLiveQuery(
    () => (machineId ? listPieceRates({ machineId }) : Promise.resolve([])),
    [machineId],
    []
  )

  // End time comes from the ending meter photo only (the true end-of-work
  // moment), not the proof-of-work photo.
  const suggested = endPhoto?.capturedAt || null
  useEffect(() => {
    if (!timeTouched && suggested) setEndTime(toLocalInput(suggested))
  }, [suggested, timeTouched])

  // Pre-fill the location from an end photo's GPS, until edited by hand.
  useEffect(() => {
    if (locTouched) return
    const g = (endPhoto?.gps?.lat != null && endPhoto.gps) || (endWorkPhoto?.gps?.lat != null && endWorkPhoto.gps) || null
    if (g) setEndLoc(formatLatLng(g.lat, g.lng))
  }, [endPhoto, endWorkPhoto, locTouched])

  // Resume a saved draft: fill the form (once) from whatever was saved on the
  // task. Photos re-hydrate from their stored rows on this device.
  useEffect(() => {
    if (hydrated.current || !task || task.status === TaskStatus.COMPLETED) return
    hydrated.current = true
    if (task.machineId) setMachineId(task.machineId)
    if (task.quantityExpr) setQuantity(task.quantityExpr)
    else if (task.quantity != null) setQuantity(String(task.quantity))
    if (task.areaId) setAreaId(task.areaId)
    if (task.notes) setNotes(task.notes)
    if (task.endTime) {
      setTimeTouched(true)
      setEndTime(toLocalInput(task.endTime))
    }
    if (task.endGps?.lat != null) {
      setLocTouched(true)
      setEndLoc(formatLatLng(task.endGps.lat, task.endGps.lng))
    }
    ;(async () => {
      if (task.endWorkPhotoId) {
        const p = await getPhoto(task.endWorkPhotoId)
        if (p) {
          const obj = { blob: p.blob || null, capturedAt: p.capturedAt, gps: p.gps, storagePath: p.storagePath }
          savedWork.current = obj // already persisted — don't re-upload on auto-save
          setEndWorkPhoto(obj)
        }
      }
      if (task.endPhotoId) {
        const p = await getPhoto(task.endPhotoId)
        if (p) {
          const obj = { blob: p.blob || null, capturedAt: p.capturedAt, gps: p.gps, storagePath: p.storagePath }
          savedMeter.current = obj
          setEndPhoto(obj)
        }
      }
    })()
  }, [task])

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

  // The saved piece rate can only be re-selected once its options load (they
  // depend on the machine). Match by id, or by name for "Kerja jam".
  useEffect(() => {
    if (rateHydrated.current || !task || !rateOptions.length) return
    if (task.pieceRateId && rateOptions.some((r) => r.id === task.pieceRateId)) {
      rateHydrated.current = true
      setRateId(task.pieceRateId)
    } else if (task.pieceRateName) {
      const m = rateOptions.find((r) => r.name === task.pieceRateName)
      if (m) {
        rateHydrated.current = true
        setRateId(m.id)
      }
    }
  }, [task, rateOptions])

  // ---- GPS distance recording (meter-unit piece work only) ----------------
  // Section shows only when the chosen work is measured in meters. Once a
  // recording is saved for this task, the quantity is LOCKED to the measured
  // total (not hand-editable) — live query so a save in the map overlay lands
  // here immediately. Multiple recordings add up; tapping the locked quantity
  // expands the per-recording audit breakdown.
  const rateIsMeters = !!rate && isDistanceUnit(rate.unit)
  const taskTracks = useLiveQuery(() => listTaskTracks(id), [id], [])
  const trackTotal = useMemo(
    () => Math.round((taskTracks || []).reduce((s, t) => s + (Number(t.distanceMeters) || 0), 0) * 10) / 10,
    [taskTracks]
  )
  const qtyLocked = rateIsMeters && trackTotal > 0
  const [showQtyFormula, setShowQtyFormula] = useState(false)
  // The recordings as an Excel-style sum, e.g. "320+150" — shown on tap and
  // saved as the record's quantity formula for audit.
  const trackExpr = useMemo(
    () => (taskTracks || []).map((t) => Math.round((Number(t.distanceMeters) || 0) * 10) / 10).join('+'),
    [taskTracks]
  )
  useEffect(() => {
    if (qtyLocked) setQuantity(String(trackTotal))
  }, [qtyLocked, trackTotal])

  const endISO = fromLocalInput(endTime)
  const durationMins = task ? minutesBetween(task.startTime, endISO) : null
  const qtyNum = evalExpr(quantity)
  const amount = rate && qtyNum != null ? qtyNum * Number(rate.price) : null

  // ---- Auto-save the draft (offline-first) --------------------------------
  // Every change is written to local IndexedDB so a half-finished task is never
  // lost, even with no connection. After each save we request a sync, which
  // pushes to the server when online and simply stays queued when offline.
  const draft = {
    endTime: endTime ? endISO : null,
    // Only pass photos that carry new bytes; already-saved ones keep their ids.
    endWorkPhoto: endWorkPhoto?.blob && endWorkPhoto !== savedWork.current ? endWorkPhoto : null,
    endPhoto: endPhoto?.blob && endPhoto !== savedMeter.current ? endPhoto : null,
    removeEndWorkPhoto: removedWork.current,
    removeEndPhoto: removedMeter.current,
    endGps: geoFor(endLoc, endPhoto?.gps || endWorkPhoto?.gps),
    machine,
    company,
    pieceRate: rate,
    quantity: qtyNum,
    // GPS-locked quantity keeps its per-recording sum (e.g. "320+150") as the
    // formula for audit — same as a manually typed sum would.
    quantityExpr: qtyLocked
      ? (taskTracks || []).length > 1
        ? trackExpr
        : null
      : isExpression(quantity)
        ? quantity.trim()
        : null,
    area,
    notes
  }
  const draftRef = useRef(draft)
  draftRef.current = draft
  const saveDraftRef = useRef(null)
  saveDraftRef.current = async () => {
    if (finalizing.current || !hydrated.current) return
    const d = draftRef.current
    try {
      // Write to the local IndexedDB first — this always succeeds offline. Only
      // after it's safely stored do we ask the sync engine to push it.
      await saveTaskProgress(id, d)
      if (d.endWorkPhoto) savedWork.current = d.endWorkPhoto
      if (d.endPhoto) savedMeter.current = d.endPhoto
      if (d.removeEndWorkPhoto) removedWork.current = false
      if (d.removeEndPhoto) removedMeter.current = false
      requestSync() // push now if online; stays queued locally when offline
    } catch {
      /* offline or month locked — the next change will retry */
    }
  }

  // Debounced auto-save on any change to the finish form (photo, machine, rate…).
  // Short delay so a filled field is persisted locally almost immediately.
  useEffect(() => {
    if (!hydrated.current) return
    const timer = setTimeout(() => saveDraftRef.current?.(), 250)
    return () => clearTimeout(timer)
  }, [endTime, endLoc, endWorkPhoto, endPhoto, machineId, rateId, quantity, areaId, notes])

  // Also flush the moment the page is hidden or closed — mobile browsers freeze
  // or kill a backgrounded PWA before an unmount would run, which is exactly when
  // an offline draft would otherwise be lost. All writes are local, so no
  // connection is needed here.
  useEffect(() => {
    const flush = () => saveDraftRef.current?.()
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flush)
    // And once more on the way out (in-app back navigation).
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])

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

  // Area is only required when the admin has set up areas for this company;
  // otherwise it's optional. Piece rate + quantity are always optional.
  const areaRequired = (areas || []).length > 0
  const canSave = endWorkPhoto && endPhoto && endTime && machineId && (!areaRequired || areaId)

  async function submit(e) {
    e.preventDefault()
    if (submitting.current) return
    setError('')
    if (!canSave) {
      setError(
        areaRequired
          ? 'Add both end photos (proof of work + ending meter), end time, machine and area.'
          : 'Add both end photos (proof of work + ending meter), end time and machine.'
      )
      return
    }
    if (durationMins == null) {
      setError('The end time is before the start time. Adjust the end time.')
      return
    }
    if (quantity.trim() !== '' && qtyNum == null) {
      setError('Quantity must be a number or a sum like 5+5+10-6.')
      return
    }
    submitting.current = true
    finalizing.current = true // stop auto-save from racing the completion
    setBusy(true)
    try {
      await completeTask(id, {
        endTime: endISO,
        endWorkPhoto,
        endPhoto,
        endGps: geoFor(endLoc, endPhoto?.gps || endWorkPhoto?.gps),
        machine,
        company,
        pieceRate: rate,
        quantity: qtyNum,
        quantityExpr: qtyLocked
          ? (taskTracks || []).length > 1
            ? trackExpr
            : null
          : isExpression(quantity)
            ? quantity.trim()
            : null,
        area,
        notes
      })
      navigate('/summary')
    } catch (err) {
      setError(err.message || 'Could not save.')
      setBusy(false)
      submitting.current = false
      finalizing.current = false // completion failed — let auto-save resume
    }
  }

  // Operators can discard a hanging task they no longer need to finish.
  async function remove() {
    if (busy) return
    if (!window.confirm('Delete this unfinished task? This cannot be undone.')) return
    finalizing.current = true // stop auto-save from re-creating what we delete
    setError('')
    setBusy(true)
    try {
      await deleteTask(id)
      navigate('/open')
    } catch (err) {
      setError(err.message || 'Could not delete.')
      setBusy(false)
      finalizing.current = false
    }
  }

  // Leaving via the back button: persist the draft to local IndexedDB FIRST,
  // then navigate — so a quick back can never lose the changes.
  async function goBack() {
    await saveDraftRef.current?.()
    navigate('/open')
  }

  return (
    <form onSubmit={submit} className="pb-4">
      <PageHeader title="Finish task" subtitle={`Started ${dateTimeOf(task.startTime)}`} onBack={goBack} />

      {/* Reference: the two start photos */}
      <Card className="mb-4 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Start of task</p>
        <div className="flex gap-2">
          <div className="flex-1">
            <PhotoById id={task.startPhotoId} className="aspect-square w-full" />
            <p className="mt-1 text-center text-[11px] text-slate-500">Meter · {timeOf(task.startTime)}</p>
          </div>
          {task.workPhotoId && (
            <div className="flex-1">
              <PhotoById id={task.workPhotoId} className="aspect-square w-full" />
              <p className="mt-1 text-center text-[11px] text-slate-500">Photo 2</p>
            </div>
          )}
        </div>
      </Card>

      <div className="space-y-4">
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
                  {r.name} — {formatRate(r.price, currency)}/{r.unit}
                </option>
              ))}
            </Select>
            {machineId && rates && rates.length === 0 && (
              <p className="mt-1 text-xs text-red-500">This machine has no piece rates yet. Ask your admin.</p>
            )}
          </Field>

          {/* GPS distance recorder — only for work measured in meters */}
          {rateIsMeters && (
            <button
              type="button"
              onClick={() => {
                // Request location INSIDE the tap gesture — browsers show the
                // full permission dialog most reliably from a user action
                // (outside a gesture Chrome may use its quiet, easy-to-miss UI).
                navigator.geolocation?.getCurrentPosition(
                  () => {},
                  () => {},
                  { maximumAge: Infinity, timeout: 5000 }
                )
                setMapOpen(true)
              }}
              className="flex w-full items-center justify-between rounded-xl border border-brand/40 bg-brand-light/50 px-3 py-3 text-left active:bg-brand-light"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-brand-dark">Measure distance on map (GPS)</p>
                <p className="text-xs text-slate-600">
                  {trackTotal > 0
                    ? `Recorded for this task: ${trackTotal.toLocaleString()} m`
                    : 'Optional — record the distance on the satellite map'}
                </p>
              </div>
              <span className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white">Open map</span>
            </button>
          )}

          <Field
            label={`Quantity${rate ? ` (${rate.unit})` : ''}`}
            hint={qtyLocked ? 'Measured on the map — tap to see the sum' : 'Optional — a number or a sum like 5+5+10-6'}
          >
            {qtyLocked ? (
              // Excel-cell behaviour, read-only: shows the total; tap to reveal
              // the sum formula (e.g. "320+150"); tap again for the total.
              <button
                type="button"
                onClick={() => setShowQtyFormula((v) => !v)}
                className="flex h-12 w-full items-center rounded-xl border border-slate-300 bg-slate-100 px-3.5 text-left font-semibold text-slate-800"
              >
                {showQtyFormula ? trackExpr : `${trackTotal.toLocaleString()} m`}
              </button>
            ) : (
              <QuantityInput value={quantity} onChange={setQuantity} placeholder="e.g. 3 or 5+5+10" />
            )}
          </Field>

          <Field label="Area" required={areaRequired} hint={areaRequired ? undefined : 'No areas set — optional'}>
            <Select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
              <option value="">{areaRequired ? 'Choose area…' : 'No area'}</option>
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

        {/* End-of-task evidence — kept last, right before Complete */}
        <PhotoCapture
          label="Proof of work"
          required
          hint="Photo showing the finished work"
          value={endWorkPhoto}
          onChange={onEndWorkPhoto}
          detectTime={false}
        />
        <PhotoCapture label="Ending meter photo" required hint="Photo of the hour-meter / mileage" value={endPhoto} onChange={onEndPhoto} />

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

        {error && <p className="text-sm text-red-500">{error}</p>}

        <Button full type="submit" disabled={busy || !canSave}>
          {busy ? 'Saving…' : 'Complete task'}
        </Button>

        <p className="text-center text-xs text-slate-500">
          Progress saves automatically — you can leave and finish this task later.
        </p>

        <Button full type="button" variant="danger" disabled={busy} onClick={remove}>
          Delete unfinished task
        </Button>
      </div>

      {/* Full-screen satellite map recorder (loads Leaflet on demand) */}
      {mapOpen && (
        <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 text-white"><Spinner className="h-8 w-8" /></div>}>
          <DistanceRecorder
            open={mapOpen}
            onClose={() => setMapOpen(false)}
            session={user}
            taskId={id}
            pieceRate={rate}
            onSaved={() => {}}
          />
        </Suspense>
      )}
    </form>
  )
}
