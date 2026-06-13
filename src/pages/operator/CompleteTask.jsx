import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { getTask, completeTask, listPieceRates, listAreas } from '../../db/repo.js'
import { TaskStatus } from '../../db/models.js'
import { minutesBetween, formatDuration } from '../../lib/duration.js'
import { timeOf, dateTimeOf, formatMoney, toLocalInput, fromLocalInput } from '../../lib/format.js'
import { getMeta } from '../../db/database.js'
import PhotoCapture from '../../components/PhotoCapture.jsx'
import { PhotoById } from '../../components/PhotoThumb.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import { Button, Card, Field, NumberInput, TextInput, TextArea, Select, Spinner } from '../../components/ui.jsx'

export default function CompleteTask() {
  const { id } = useParams()
  const navigate = useNavigate()

  const task = useLiveQuery(() => getTask(id), [id], undefined)
  const rates = useLiveQuery(() => listPieceRates(), [], [])
  const areas = useLiveQuery(() => listAreas(), [], [])
  const currency = useLiveQuery(() => getMeta('currency', 'RM'), [], 'RM')

  const [endPhoto, setEndPhoto] = useState(null)
  const [endTime, setEndTime] = useState('')
  const [timeTouched, setTimeTouched] = useState(false)
  const [rateId, setRateId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [areaId, setAreaId] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Suggest end time from the end photo until edited by hand.
  const suggested = endPhoto?.capturedAt || null
  useEffect(() => {
    if (!timeTouched && suggested) setEndTime(toLocalInput(suggested))
  }, [suggested, timeTouched])

  const rate = useMemo(() => (rates || []).find((r) => r.id === rateId) || null, [rates, rateId])
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

  const canSave = endPhoto && endTime && rateId && quantity !== '' && Number(quantity) > 0 && areaId

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (!canSave) {
      setError('Add the end photo, end time, piece rate, quantity and area.')
      return
    }
    if (durationMins == null) {
      setError('The end time is before the start time. Adjust the end time.')
      return
    }
    setBusy(true)
    try {
      await completeTask(id, {
        endTime: endISO,
        endPhoto,
        pieceRate: rate,
        quantity,
        area,
        notes
      })
      navigate('/summary')
    } catch (err) {
      setError(err.message || 'Could not save.')
      setBusy(false)
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
          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
            <span className="text-sm text-slate-500">Duration (auto)</span>
            <span className="text-lg font-bold text-slate-800">
              {durationMins == null ? '—' : formatDuration(durationMins)}
            </span>
          </div>
        </Card>

        <Card className="space-y-4 p-4">
          <Field label="Piece rate work" required>
            <Select value={rateId} onChange={(e) => setRateId(e.target.value)}>
              <option value="">Choose work type…</option>
              {(rates || []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} — {formatMoney(r.price, currency)}/{r.unit}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={`Quantity${rate ? ` (${rate.unit})` : ''}`} required hint="Units of work done">
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
