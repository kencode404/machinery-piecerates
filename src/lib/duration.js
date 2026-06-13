// Duration is always derived from the start and end timestamps (which come
// from the photos), never typed by hand on the operator side.

/** Whole minutes between two ISO timestamps, or null if invalid/negative. */
export function minutesBetween(startISO, endISO) {
  if (!startISO || !endISO) return null
  const ms = new Date(endISO).getTime() - new Date(startISO).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  return Math.round(ms / 60000)
}

/** "2h 15m" / "45m" / "—". */
export function formatDuration(mins) {
  if (mins == null) return '—'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m}m`
}
