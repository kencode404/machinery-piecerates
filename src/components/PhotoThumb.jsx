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

export function PhotoThumb({ photo, className = '', onZoom }) {
  const url = usePhotoUrl(photo)
  if (!photo) return null
  if (!url) {
    return (
      <div className={`flex items-center justify-center rounded-lg bg-slate-100 text-[10px] text-slate-400 ${className}`}>
        No image
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onZoom ? () => onZoom(url) : undefined}
      className={`overflow-hidden rounded-lg bg-slate-100 ${className}`}
    >
      <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
    </button>
  )
}

/** Thumbnail that loads a photo by id from IndexedDB. */
export function PhotoById({ id, className = '', onZoom }) {
  const photo = useLiveQuery(() => (id ? getPhoto(id) : undefined), [id])
  if (!id) return null
  return <PhotoThumb photo={photo} className={className} onZoom={onZoom} />
}

/** Simple fullscreen image viewer. Pass `url` (truthy) to show. */
export function Lightbox({ url, onClose }) {
  if (!url) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
      onClick={onClose}
    >
      <img src={url} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
      <button
        className="absolute right-4 top-4 rounded-full bg-white/15 px-3 py-1 text-white"
        onClick={onClose}
      >
        Close
      </button>
    </div>
  )
}
