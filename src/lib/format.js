// Small pure formatting / date-key helpers. No app state here.

/** Local "YYYY-MM-DD" for a Date or ISO string. */
export function dayKeyOf(d) {
  const x = d instanceof Date ? d : new Date(d)
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
}

/** Local "YYYY-MM" for a Date or ISO string. */
export function monthKeyOf(d) {
  const x = d instanceof Date ? d : new Date(d)
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}`
}

/** Number of days in the month of a "YYYY-MM" key (handles 28/30/31). */
export function daysInMonth(monthKey) {
  const [y, m] = monthKey.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

/** Human label for a month key, e.g. "June 2026". */
export function monthLabel(monthKey) {
  const [y, m] = monthKey.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/** Shift a "YYYY-MM" key by n months. */
export function shiftMonth(monthKey, n) {
  const [y, m] = monthKey.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return monthKeyOf(d)
}

// Retention: keep the work month (and payroll month) for ~3 years. Records and
// payroll older than this — judged by the saved data month, not the edit date —
// are hidden from navigation and auto-purged to save space.
export const RETENTION_MONTHS = 36

/** Oldest work-month "YYYY-MM" still kept (36 months incl. the current month). */
export function minRetainedMonthKey(now = new Date()) {
  return shiftMonth(monthKeyOf(now), -(RETENTION_MONTHS - 1))
}

// Latitude + longitude are edited as a single "lat, lng" field.
export function formatLatLng(lat, lng) {
  if (lat == null && lng == null) return ''
  return `${lat ?? ''}, ${lng ?? ''}`
}
export function parseLatLng(str) {
  if (!str || !str.trim()) return { lat: null, lng: null }
  const [a, b] = str.split(',').map((s) => s.trim())
  const num = (v) => (v !== '' && v != null && Number.isFinite(Number(v)) ? Number(v) : null)
  return { lat: num(a), lng: num(b) }
}

/** "13 Jun" style short day label from a day key or ISO. */
export function shortDay(d) {
  const x = d instanceof Date ? d : new Date(d)
  return x.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
}

/** Weekday + day, e.g. "Sat 13". */
export function weekdayDay(d) {
  const x = d instanceof Date ? d : new Date(d)
  return x.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit' })
}

/** "3:45 PM" style time. Returns "—" for empty. */
export function timeOf(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** Full local date-time, e.g. for detail rows. */
export function dateTimeOf(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit'
  })
}

/** Full local date-time INCLUDING seconds (timestamps are second-accurate). */
export function dateTimeSecondsOf(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit'
  })
}

/**
 * Convert an ISO string to the value a <input type="datetime-local" step="1">
 * wants — local time, to the second.
 */
export function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const off = d.getTimezoneOffset()
  const local = new Date(d.getTime() - off * 60000)
  return local.toISOString().slice(0, 19) // YYYY-MM-DDTHH:MM:SS
}

/** Convert a <input type="datetime-local"> value back to ISO. */
export function fromLocalInput(v) {
  if (!v) return null
  return new Date(v).toISOString()
}

export function pad(n) {
  return String(n).padStart(2, '0')
}

/** Format money with a currency symbol/prefix (default "RM"). */
export function formatMoney(n, currency = 'RM') {
  const v = Number(n) || 0
  return `${currency} ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Format a quantity with its unit, e.g. "3 m". */
export function formatQty(n, unit = '') {
  const v = Number(n)
  const num = Number.isFinite(v) ? trimNumber(v) : 0
  return unit ? `${num} ${unit}` : `${num}`
}

/** Drop trailing zeros: 3.00 -> "3", 3.50 -> "3.5". */
export function trimNumber(v) {
  return Number(v).toString()
}

/** Human file size, e.g. "284 KB", "1.2 MB". */
export function formatBytes(n) {
  if (n == null || Number.isNaN(n)) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Short GPS label, e.g. "3.13921, 101.68685". */
export function formatGps(gps) {
  if (!gps || gps.lat == null || gps.lng == null) return 'No location'
  return `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`
}
