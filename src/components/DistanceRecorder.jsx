import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useLiveQuery } from 'dexie-react-hooks'
import { TrackRecorder, MAX_ACCURACY_M } from '../lib/geotrack.js'
import { addTrack, listTracks } from '../db/repo.js'
import { monthKeyOf, monthLabel } from '../lib/format.js'
import { tracksToKML, tracksToGPX, downloadFile } from '../lib/geotrack.js'
import { Button } from './ui.jsx'

// Free satellite imagery (no API key). Looks like Google's satellite view.
const SAT_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const SAT_ATTRIB = 'Imagery © Esri'
const FALLBACK_CENTER = [4.2105, 108.9758] // Malaysia-ish, used only before the first GPS fix

const fmtM = (m) => `${(Math.round(m * 10) / 10).toLocaleString()} m`

/**
 * Full-screen satellite-map overlay where an operator records the distance
 * they drive for meter-unit piece work. Start / Pause / End(save); the saved
 * distance is reported to the parent (which locks it into the task quantity).
 * This month's earlier recordings are drawn underneath and exportable KML/GPX.
 *
 * Recording works offline (GPS needs no network) — only the imagery tiles do.
 */
export default function DistanceRecorder({ open, onClose, session, taskId, pieceRate, onSaved }) {
  const mapDiv = useRef(null)
  const mapRef = useRef(null)
  const liveLine = useRef(null) // polyline of the in-progress recording
  const hereDot = useRef(null) // current-location marker
  const monthLayer = useRef(null) // this month's saved tracks
  const recorder = useRef(null)

  const [rec, setRec] = useState({ running: false, paused: false, distance: 0, points: [], lastFix: null })
  const [fix, setFix] = useState(null) // warm-up GPS fix while idle (gates Start)
  const centered = useRef(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // Visual smoothing: GPS fixes land ~once a second, which looks choppy if the
  // dot/line/counter jump to each fix. A 60fps loop glides the shown position
  // and meter count toward the latest real values instead. Display only — the
  // measured distance itself is untouched.
  const distEl = useRef(null) // big meter readout, updated imperatively
  const smooth = useRef({ pos: null, target: null, linePts: [], extendLine: false, dist: 0, distTarget: 0 })

  const monthKey = monthKeyOf(new Date())
  const monthTracks = useLiveQuery(
    () => (open && session?.operatorId ? listTracks({ operatorId: session.operatorId, monthKey }) : []),
    [open, session?.operatorId, monthKey],
    []
  )
  const monthTotal = useMemo(
    () => (monthTracks || []).reduce((s, t) => s + (Number(t.distanceMeters) || 0), 0),
    [monthTracks]
  )

  // Create the map when the overlay opens, destroy it when it closes.
  useEffect(() => {
    if (!open || !mapDiv.current) return
    const map = L.map(mapDiv.current, { zoomControl: false, attributionControl: true })
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    L.tileLayer(SAT_TILES, { maxZoom: 19, attribution: SAT_ATTRIB }).addTo(map)
    map.setView(FALLBACK_CENTER, 6)
    mapRef.current = map
    monthLayer.current = L.layerGroup().addTo(map)
    liveLine.current = L.polyline([], { color: '#ef4444', weight: 4 }).addTo(map)
    hereDot.current = L.circleMarker(FALLBACK_CENTER, {
      radius: 7,
      color: '#ffffff',
      weight: 2,
      fillColor: '#2563eb',
      fillOpacity: 1
    }).addTo(map)

    // The overlay animates in — Leaflet needs a size poke once it's visible.
    setTimeout(() => mapRef.current?.invalidateSize(), 60)

    return () => {
      recorder.current?.stop()
      recorder.current = null
      clearRecordingNotification()
      map.remove()
      mapRef.current = null
      centered.current = false
      resetSmooth()
      smooth.current.pos = null
      smooth.current.target = null
      setRec({ running: false, paused: false, distance: 0, points: [], lastFix: null })
      setFix(null)
      setError('')
    }
  }, [open])

  // The 60fps glide loop (exponential approach: each frame closes ~12-15% of
  // the remaining gap, so motion is fluid and settles fast without overshoot).
  useEffect(() => {
    if (!open) return
    let raf
    const tick = () => {
      const s = smooth.current
      if (s.target) {
        s.pos = s.pos
          ? [s.pos[0] + (s.target[0] - s.pos[0]) * 0.12, s.pos[1] + (s.target[1] - s.pos[1]) * 0.12]
          : s.target
        hereDot.current?.setLatLng(s.pos)
        // The live red line grows continuously to the gliding dot.
        if (liveLine.current) liveLine.current.setLatLngs(s.extendLine ? [...s.linePts, s.pos] : s.linePts)
      }
      s.dist += (s.distTarget - s.dist) * 0.15
      if (Math.abs(s.distTarget - s.dist) < 0.05) s.dist = s.distTarget
      if (distEl.current) distEl.current.textContent = fmtM(s.dist)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [open])

  // If location is hard-blocked for this site, say so (with the fix) the
  // moment the map opens — a denied state can never re-prompt, so waiting on
  // GPS would just look broken.
  useEffect(() => {
    if (!open || !navigator.permissions?.query) return
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((st) => {
        if (st.state === 'denied')
          setError('Location is blocked for this site. Tap the lock icon next to the address → Permissions → Location → Allow, then reload.')
      })
      .catch(() => {})
  }, [open])

  // Warm up the GPS from the moment the map opens: a live watch that moves the
  // blue dot, centers the map on the first fix, and reports accuracy so Start
  // stays disabled until the fix is tight enough to measure with. (While
  // recording, the recorder's own watch takes over feeding the dot.)
  useEffect(() => {
    if (!open || rec.running || !navigator.geolocation) return
    const wid = navigator.geolocation.watchPosition(
      (pos) => {
        const f = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null }
        setFix(f)
        smooth.current.target = [f.lat, f.lng] // dot glides there via the rAF loop
        if (!centered.current && mapRef.current) {
          centered.current = true
          mapRef.current.setView([f.lat, f.lng], 18)
        }
      },
      (err) => {
        if (err.code === 1)
          setError('Location is blocked for this site. Tap the lock icon next to the address → Permissions → Location → Allow, then reload.')
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    )
    return () => navigator.geolocation.clearWatch(wid)
  }, [open, rec.running])

  // Draw this month's saved tracks (blue, under the live red line).
  useEffect(() => {
    const layer = monthLayer.current
    if (!open || !layer) return
    layer.clearLayers()
    for (const t of monthTracks || []) {
      if (!t.points?.length) continue
      L.polyline(
        t.points.map((p) => [p.lat, p.lng]),
        { color: '#3b82f6', weight: 3, opacity: 0.6 }
      ).addTo(layer)
    }
  }, [open, monthTracks])

  function onUpdate({ points, distance, lastFix, paused }) {
    setRec({ running: !!recorder.current?.running, paused, distance, points, lastFix })
    // Feed the glide loop — it moves the dot, grows the line, counts the meter.
    const s = smooth.current
    if (lastFix) s.target = [lastFix.lat, lastFix.lng]
    s.linePts = points.map((p) => [p.lat, p.lng])
    s.extendLine = !!recorder.current?.running && !paused
    s.distTarget = distance
    // Follow the machine WITHOUT fighting the operator's own pan/pinch: only
    // re-center when the dot nears the edge of the view. An unconditional
    // panTo on every fix cancels in-progress gestures and makes the map feel
    // like it zooms/jumps on its own.
    if (lastFix && mapRef.current && !paused) {
      const ll = [lastFix.lat, lastFix.lng]
      if (!mapRef.current.getBounds().pad(-0.2).contains(ll)) mapRef.current.panTo(ll)
    }
  }

  // Persistent "recording" notification: a visible reminder in the phone's
  // shade while tracking runs (it can NOT keep GPS alive in background — no
  // web API can — but the wake lock keeps the screen on, and the notification
  // reminds the operator a session is live if they switch apps).
  async function showRecordingNotification() {
    try {
      if (!('Notification' in window) || !navigator.serviceWorker) return
      if (Notification.permission === 'default') await Notification.requestPermission()
      if (Notification.permission !== 'granted') return
      const reg = await navigator.serviceWorker.ready
      reg.showNotification('Recording distance…', {
        tag: 'distance-recording',
        body: 'GPS tracking is running. Keep the app open — return here to continue.',
        icon: `${import.meta.env.BASE_URL}pwa-192x192.png`,
        silent: true,
        requireInteraction: true
      })
    } catch {
      /* best effort */
    }
  }

  async function clearRecordingNotification() {
    try {
      const reg = await navigator.serviceWorker?.ready
      const ns = await reg?.getNotifications({ tag: 'distance-recording' })
      ns?.forEach((n) => n.close())
    } catch {
      /* best effort */
    }
  }

  async function start() {
    setError('')
    recorder.current = new TrackRecorder({ onUpdate, onError: setError })
    await recorder.current.start()
    setRec((r) => ({ ...r, running: true, paused: false }))
    showRecordingNotification()
  }

  const pause = () => recorder.current?.pause()
  const resume = () => recorder.current?.resume()

  // Snap the glide layer back to zero (line cleared, counter reset).
  function resetSmooth() {
    const s = smooth.current
    s.linePts = []
    s.extendLine = false
    s.dist = 0
    s.distTarget = 0
  }

  async function endAndSave() {
    const r = recorder.current
    if (!r) return
    const result = r.stop()
    recorder.current = null
    clearRecordingNotification()
    if (!result.points.length || result.distance <= 0) {
      // Nothing measured — just reset, don't save an empty track.
      setRec({ running: false, paused: false, distance: 0, points: [] })
      resetSmooth()
      setError(result.points.length ? '' : 'No movement recorded — nothing to save.')
      return
    }
    setSaving(true)
    try {
      await addTrack({
        session,
        taskId,
        pieceRate,
        points: result.points,
        distanceMeters: result.distance,
        startedAt: result.startedAt,
        endedAt: result.endedAt
      })
      resetSmooth()
      setRec({ running: false, paused: false, distance: 0, points: [] })
      onSaved?.() // parent re-reads the task total and locks the quantity
    } catch (err) {
      setError(err.message || 'Could not save the recording.')
    } finally {
      setSaving(false)
    }
  }

  function exportMonth(kind) {
    const tracks = (monthTracks || [])
      .filter((t) => t.points?.length)
      .map((t) => ({
        name: `${t.pieceRateName || 'Work'} · ${t.dayKey} · ${Math.round(t.distanceMeters)} m`,
        points: t.points,
        distanceMeters: t.distanceMeters,
        startedAt: t.startedAt
      }))
    if (!tracks.length) return
    const docName = `${session?.operatorName || 'Operator'} — ${monthLabel(monthKey)}`
    const base = `${(session?.operatorName || 'operator').replace(/\s+/g, '_')}_tracks_${monthKey}`
    if (kind === 'kml') downloadFile(`${base}.kml`, tracksToKML(tracks, docName), 'application/vnd.google-earth.kml+xml')
    else downloadFile(`${base}.gpx`, tracksToGPX(tracks, docName), 'application/gpx+xml')
  }

  if (!open) return null
  const idle = !rec.running
  // Gate Start on a fix at least as tight as what the recorder will accept —
  // otherwise the first points would be silently rejected anyway.
  const gpsReady = fix?.accuracy != null && fix.accuracy <= MAX_ACCURACY_M
  const accNow = rec.running ? rec.lastFix?.accuracy : fix?.accuracy
  const accColor = accNow == null ? 'text-white/60' : accNow <= 10 ? 'text-green-300' : accNow <= MAX_ACCURACY_M ? 'text-amber-300' : 'text-red-300'

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Map fills the screen */}
      <div ref={mapDiv} className="min-h-0 flex-1" />

      {/* Top bar: distance + close */}
      <div className="pt-safe absolute inset-x-0 top-0 z-[1000] flex items-start justify-between p-3">
        <div className="rounded-xl bg-black/70 px-4 py-2 text-white shadow">
          {/* Updated at 60fps by the glide loop (imperative — avoids re-rendering per frame) */}
          <p ref={distEl} className="text-2xl font-bold leading-tight">0 m</p>
          <p className="text-[11px] text-white/70">
            {rec.running ? (rec.paused ? 'Paused' : 'Recording…') : 'This recording'}
            {' · '}bulan ini {fmtM(monthTotal)}
          </p>
          <p className={`text-[11px] font-medium ${accColor}`}>
            {accNow != null ? `GPS ±${Math.round(accNow)} m` : 'Getting GPS…'}
            {rec.running && accNow != null && accNow > MAX_ACCURACY_M
              ? ' — weak signal, count on hold'
              : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={rec.running}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-black/70 text-xl text-white shadow disabled:opacity-40"
          aria-label="Close map"
        >
          ×
        </button>
      </div>

      {/* Bottom controls */}
      <div className="pb-safe absolute inset-x-0 bottom-0 z-[1000] space-y-2 p-3">
        {error && <p className="rounded-lg bg-black/70 px-3 py-2 text-center text-sm text-red-300">{error}</p>}
        {rec.running && (
          <p className="rounded-lg bg-black/70 px-3 py-1.5 text-center text-[11px] text-white/80">
            Screen stays awake while recording. If it turns off anyway, ground covered is
            added as a straight line when you come back.
          </p>
        )}
        {idle ? (
          <div className="flex gap-2">
            <Button type="button" full onClick={start} disabled={saving || !gpsReady}>
              {saving
                ? 'Saving…'
                : gpsReady
                  ? '● Start recording'
                  : fix?.accuracy != null
                    ? `Waiting for GPS… ±${Math.round(fix.accuracy)} m`
                    : 'Waiting for GPS…'}
            </Button>
            {(monthTracks || []).some((t) => t.points?.length) && (
              <>
                <Button type="button" variant="secondary" onClick={() => exportMonth('kml')}>KML</Button>
                <Button type="button" variant="secondary" onClick={() => exportMonth('gpx')}>GPX</Button>
              </>
            )}
          </div>
        ) : (
          <div className="flex gap-2">
            {rec.paused ? (
              <Button type="button" full variant="secondary" onClick={resume}>▶ Resume</Button>
            ) : (
              <Button type="button" full variant="secondary" onClick={pause}>⏸ Pause</Button>
            )}
            <Button type="button" full onClick={endAndSave} disabled={saving}>
              {saving ? 'Saving…' : '■ End & save'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
