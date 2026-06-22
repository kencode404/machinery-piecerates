import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext.jsx'
import { startTask } from '../../db/repo.js'
import { GpsSource } from '../../db/models.js'
import { toLocalInput, fromLocalInput, formatLatLng, parseLatLng } from '../../lib/format.js'

const geoFor = (loc, fallback) => {
  const { lat, lng } = parseLatLng(loc)
  if (lat == null && lng == null) return fallback || undefined
  const changed = lat !== (fallback?.lat ?? null) || lng !== (fallback?.lng ?? null)
  return { lat, lng, source: changed ? GpsSource.MANUAL : fallback?.source || GpsSource.DEVICE, accuracy: fallback?.accuracy ?? null }
}
import PhotoCapture from '../../components/PhotoCapture.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import { Button, Card, Field, TextInput, TextArea } from '../../components/ui.jsx'

export default function NewTask() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [photo1, setPhoto1] = useState(null)
  const [photo2, setPhoto2] = useState(null)
  const [startTime, setStartTime] = useState('')
  const [timeTouched, setTimeTouched] = useState(false)
  const [startLoc, setStartLoc] = useState('')
  const [locTouched, setLocTouched] = useState(false)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false) // synchronous double-submit guard

  // Suggest the start time from the first photo with a timestamp, until the
  // operator edits it by hand.
  const suggested = photo1?.capturedAt || photo2?.capturedAt || null
  useEffect(() => {
    if (!timeTouched && suggested) setStartTime(toLocalInput(suggested))
  }, [suggested, timeTouched])

  // Pre-fill the location from the first photo with GPS, until edited by hand.
  useEffect(() => {
    if (locTouched) return
    const g = (photo1?.gps?.lat != null && photo1.gps) || (photo2?.gps?.lat != null && photo2.gps) || null
    if (g) setStartLoc(formatLatLng(g.lat, g.lng))
  }, [photo1, photo2, locTouched])

  const canSave = photo1 && photo2 && startTime

  async function submit(e) {
    e.preventDefault()
    if (submitting.current) return
    setError('')
    if (!canSave) {
      setError('Add both proof photos and a start time.')
      return
    }
    submitting.current = true
    setBusy(true)
    try {
      await startTask({
        session: user, // carries companyId/companyName/machineId/machineName/operatorName
        startTime: fromLocalInput(startTime),
        startGps: geoFor(startLoc, photo1?.gps || photo2?.gps),
        notes,
        startPhoto: photo1,
        workPhoto: photo2
      })
      navigate('/open')
    } catch (err) {
      setError(err.message || 'Could not save.')
      setBusy(false)
      submitting.current = false
    }
  }

  return (
    <form onSubmit={submit} className="pb-4">
      <PageHeader
        title="Start a task"
        subtitle="Take two proof photos. Finish it later."
        onBack={() => navigate('/open')}
      />

      <div className="space-y-4">
        <PhotoCapture label="Proof photo 1" required hint="e.g. the machine / site" value={photo1} onChange={setPhoto1} />
        <PhotoCapture label="Proof photo 2" required hint="e.g. the work being done" value={photo2} onChange={setPhoto2} />

        <Card className="space-y-3 p-4">
          <Field label="Start time" required hint="Taken from the photo — edit if needed">
            <TextInput
              type="datetime-local"
              step="1"
              value={startTime}
              onChange={(e) => {
                setTimeTouched(true)
                setStartTime(e.target.value)
              }}
            />
          </Field>
          <Field label="Start location" hint="From the photo — edit if needed (latitude, longitude)">
            <TextInput
              value={startLoc}
              onChange={(e) => {
                setLocTouched(true)
                setStartLoc(e.target.value)
              }}
              placeholder="e.g. 3.13921, 101.6869"
            />
          </Field>
          <Field label="Notes (optional)">
            <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything to remember…" />
          </Field>
        </Card>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <Button full type="submit" disabled={busy || !canSave}>
          {busy ? 'Saving…' : 'Save & leave open'}
        </Button>
      </div>
    </form>
  )
}
