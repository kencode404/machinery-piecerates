import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext.jsx'
import { startTask } from '../../db/repo.js'
import { toLocalInput, fromLocalInput } from '../../lib/format.js'
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
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Suggest the start time from the first photo with a timestamp, until the
  // operator edits it by hand.
  const suggested = photo1?.capturedAt || photo2?.capturedAt || null
  useEffect(() => {
    if (!timeTouched && suggested) setStartTime(toLocalInput(suggested))
  }, [suggested, timeTouched])

  const canSave = photo1 && photo2 && startTime

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (!canSave) {
      setError('Add both proof photos and a start time.')
      return
    }
    setBusy(true)
    try {
      await startTask({
        session: user, // carries companyId/companyName/machineId/machineName/operatorName
        startTime: fromLocalInput(startTime),
        notes,
        startPhoto: photo1,
        workPhoto: photo2
      })
      navigate('/open')
    } catch (err) {
      setError(err.message || 'Could not save.')
      setBusy(false)
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
