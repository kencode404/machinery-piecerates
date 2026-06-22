import { useRef, useState } from 'react'
import { capturePhotoMeta } from '../lib/photoMeta.js'
import { compressImage } from '../lib/image.js'
import { GpsSource } from '../db/models.js'
import { dateTimeSecondsOf, formatGps, formatBytes } from '../lib/format.js'
import { usePhotoUrl, Lightbox } from './PhotoThumb.jsx'
import { IconCamera, IconPin, IconClock } from './icons.jsx'
import { Spinner } from './ui.jsx'

/**
 * Capture one photo. A single "Take photo" button opens the device's native
 * chooser, which offers BOTH the camera and uploading from phone storage
 * (we deliberately omit the `capture` attribute so the user can pick either).
 * The photo's timestamp (to the second) + GPS are read from its EXIF, falling
 * back to the live device GPS/clock only when the file has none.
 *
 * value:    { blob, capturedAt, gps, timeSource } | null
 * onChange: (captured | null) => void
 */
export default function PhotoCapture({ label, hint, value, onChange, required, compact }) {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [zoom, setZoom] = useState(null)
  const previewUrl = usePhotoUrl(value)

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file) return
    setBusy(true)
    try {
      // Read EXIF from the ORIGINAL file first (compression strips metadata).
      const meta = await capturePhotoMeta(file)
      const blob = await compressImage(file)
      onChange({ blob, capturedAt: meta.capturedAt, gps: meta.gps, timeSource: meta.timeSource })
    } catch (err) {
      console.error('Photo capture failed', err)
      alert('Could not read that photo. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const gpsOk = value?.gps && value.gps.lat != null
  const sourceLabel =
    value?.gps?.source === GpsSource.EXIF
      ? 'from photo'
      : value?.gps?.source === GpsSource.DEVICE
        ? 'from device'
        : null

  // Compact square tile — used for the optional 3-up photo box on the admin forms.
  if (compact) {
    return (
      <div>
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={handleFile} />
        {!value ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 bg-white text-slate-400 active:bg-slate-50"
          >
            {busy ? <Spinner /> : <IconCamera width={20} height={20} />}
            {label && <span className="text-[11px] font-medium">{label}</span>}
          </button>
        ) : (
          <div className="relative aspect-square overflow-hidden rounded-xl border border-slate-200">
            <img
              src={previewUrl || ''}
              alt=""
              onClick={() => previewUrl && setZoom(previewUrl)}
              className="h-full w-full object-cover"
            />
            <button
              type="button"
              onClick={() => onChange(null)}
              className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs leading-none text-white"
              aria-label="Remove photo"
            >
              ×
            </button>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="absolute inset-x-0 bottom-0 bg-black/50 py-0.5 text-center text-[10px] text-white"
            >
              {label || 'Change'}
            </button>
          </div>
        )}
        <Lightbox url={zoom} onClose={() => setZoom(null)} />
      </div>
    )
  }

  return (
    <div>
      {label && (
        <p className="mb-1.5 text-sm font-medium text-slate-700">
          {label} {required && <span className="text-red-500">*</span>}
        </p>
      )}

      {/* No `capture` attr => native sheet offers Camera + Photo Library + Files */}
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={handleFile} />

      {!value ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-4">
          {busy ? (
            <div className="flex flex-col items-center gap-2 py-6 text-slate-500">
              <Spinner />
              <span className="text-sm">Reading photo & location…</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex w-full flex-col items-center gap-1 rounded-xl bg-brand py-5 text-white active:bg-brand-dark"
            >
              <IconCamera width={28} height={28} />
              <span className="text-base font-medium">Take photo</span>
              <span className="text-[11px] text-white/80">Camera or upload from phone</span>
            </button>
          )}
          {hint && <p className="mt-2 text-center text-xs text-slate-400">{hint}</p>}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="relative">
            <img
              src={previewUrl || ''}
              alt=""
              onClick={() => previewUrl && setZoom(previewUrl)}
              className="h-44 w-full object-cover"
            />
            {busy && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 text-white">
                <Spinner />
              </div>
            )}
          </div>
          <div className="space-y-1 p-3 text-sm">
            <div className="flex items-center gap-2 text-slate-600">
              <IconClock width={15} height={15} className="text-slate-400" />
              <span>{dateTimeSecondsOf(value.capturedAt)}</span>
              {value.timeSource === GpsSource.DEVICE && (
                <span className="text-[11px] text-amber-600">(device time)</span>
              )}
            </div>
            <div className="flex items-center gap-2 text-slate-600">
              <IconPin width={15} height={15} className={gpsOk ? 'text-slate-400' : 'text-red-400'} />
              <span className={gpsOk ? '' : 'text-red-500'}>{formatGps(value.gps)}</span>
              {sourceLabel && <span className="text-[11px] text-slate-400">({sourceLabel})</span>}
            </div>
            {!gpsOk && (
              <p className="text-[11px] text-red-500">
                No location found. Allow location access, or upload a photo that has GPS.
              </p>
            )}
            {value.blob?.size != null && (
              <p className="text-[11px] text-slate-400">Upload size ≈ {formatBytes(value.blob.size)}</p>
            )}
          </div>
          <div className="flex border-t border-slate-100">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex-1 py-2.5 text-sm font-medium text-brand active:bg-brand-light"
            >
              Change photo
            </button>
            <div className="w-px bg-slate-100" />
            <button
              type="button"
              onClick={() => onChange(null)}
              className="flex-1 py-2.5 text-sm font-medium text-red-500 active:bg-red-50"
            >
              Remove
            </button>
          </div>
        </div>
      )}

      <Lightbox url={zoom} onClose={() => setZoom(null)} />
    </div>
  )
}
