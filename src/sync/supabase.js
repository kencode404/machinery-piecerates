import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// All tables live in this dedicated schema (configurable via .env).
export const SCHEMA = import.meta.env.VITE_SUPABASE_SCHEMA || 'machinery-piecerate'
export const PHOTO_BUCKET = import.meta.env.VITE_SUPABASE_PHOTO_BUCKET || 'photos'

// Sync only turns on when both URL + key are present. Otherwise the app is
// fully usable offline / local-only.
export const supabaseEnabled = Boolean(url && anonKey)

export const supabase = supabaseEnabled
  ? createClient(url, anonKey, {
      db: { schema: SCHEMA },
      auth: { persistSession: true, autoRefreshToken: true },
      global: { headers: { 'x-application-name': 'machinery-piece-rates' } }
    })
  : null

/** Public URL for a photo stored in the bucket (bucket must be public). */
export function publicPhotoUrl(storagePath) {
  if (!supabase || !storagePath) return null
  return supabase.storage.from(PHOTO_BUCKET).getPublicUrl(storagePath).data.publicUrl
}
