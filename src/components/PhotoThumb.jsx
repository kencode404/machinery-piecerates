import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getPhoto } from '../db/repo.js'
import { publicPhotoUrl } from '../sync/supabase.js'

/**
 * Resolve a displayable URL for a photo, whether its bytes live locally
 * (Blob in IndexedDB) or only in Supabase Storage (synced from another device).
 */
export function usePhotoUrl(photo) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (!photo) {
      setUrl(null)
      return
    }
    if (photo.blob) {
      const u = URL.createObjectURL(photo.blob)
      setUrl(u)
      return () => URL.revokeObjectURL(u)
    }
    if (photo.storagePath) {
      setUrl(publicPhotoUrl(photo.storagePath))
      return
    }
    setUrl(null)
  }, [photo?.blob, photo?.storagePath])
  return url
}

export function PhotoThumb({ photo, className = '', onZoom, language = 'en' }) {
  const ms = language === 'ms'
  const url = usePhotoUrl(photo)
  if (!photo) return null
  if (!url) {
    return (
      <div className={`flex items-center justify-center rounded-lg bg-slate-100 text-[10px] text-slate-500 ${className}`}>
        {ms ? 'Tiada gambar' : 'No image'}
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onZoom ? () => onZoom(url) : undefined}
      aria-label={onZoom ? (ms ? 'Lihat gambar' : 'View full image') : undefined}
      className={`overflow-hidden rounded-lg bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${className}`}
    >
      <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
    </button>
  )
}

/** Thumbnail that loads a photo by id from IndexedDB. */
export function PhotoById({ id, className = '', onZoom, language = 'en' }) {
  const photo = useLiveQuery(() => (id ? getPhoto(id) : undefined), [id])
  if (!id) return null
  return <PhotoThumb photo={photo} className={className} onZoom={onZoom} language={language} />
}

/** Simple fullscreen image viewer. Pass `url` (truthy) to show. */
export function Lightbox({ url, onClose, language = 'en' }) {
  const ms = language === 'ms'
  useEffect(() => {
    if (!url) return undefined
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [url, onClose])

  if (!url) return null
  return (
    <div
      className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/90 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={ms ? 'Paparan gambar' : 'Full-size photo preview'}
    >
      <img src={url} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
      <button
        type="button"
        className="absolute right-4 top-4 min-h-11 rounded-full bg-white/15 px-4 py-2 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        onClick={onClose}
      >
        {ms ? 'Tutup' : 'Close'}
      </button>
    </div>
  )
}
