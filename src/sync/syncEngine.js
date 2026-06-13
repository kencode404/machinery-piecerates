// Offline-first sync engine.
//
// Writes always land in IndexedDB first (see repo.js) with syncStatus
// 'pending'. This engine pushes pending rows + photo blobs to Supabase when
// online, then pulls presets and other-device records back down. It is safe to
// call requestSync() liberally — runs are serialised and debounced.

import { supabase, supabaseEnabled, PHOTO_BUCKET } from './supabase.js'
import { db, getMeta, setMeta } from '../db/database.js'
import { onChange } from './bus.js'
import { SyncStatus } from '../db/models.js'
import {
  toServerTask,
  fromServerTask,
  toServerPhoto,
  fromServerPhoto,
  toServerCompany,
  fromServerCompany,
  toServerMachine,
  fromServerMachine,
  toServerPieceRate,
  fromServerPieceRate,
  toServerArea,
  fromServerArea
} from './mappers.js'

const EPOCH = '1970-01-01T00:00:00.000Z'

let state = {
  enabled: supabaseEnabled,
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  syncing: false,
  pending: 0,
  lastError: null,
  lastSyncAt: null
}

const subs = new Set()
function setState(patch) {
  state = { ...state, ...patch }
  subs.forEach((fn) => {
    try {
      fn(state)
    } catch {
      /* ignore */
    }
  })
}
export function getSyncState() {
  return state
}
export function subscribeSync(fn) {
  subs.add(fn)
  fn(state)
  return () => subs.delete(fn)
}

let running = false
let queued = false
let interval = null
let started = false

export function startSync() {
  if (started) return
  started = true
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      setState({ online: true })
      requestSync()
    })
    window.addEventListener('offline', () => setState({ online: false }))
  }
  onChange(() => {
    refreshPending()
    requestSync()
  })
  interval = setInterval(() => requestSync(), 60_000)
  refreshPending()
  requestSync()
}

export function requestSync() {
  if (!supabaseEnabled) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) return
  if (running) {
    queued = true
    return
  }
  run()
}

async function run() {
  running = true
  setState({ syncing: true, lastError: null })
  try {
    // Push local changes first so our edits win, then pull remote changes.
    // Order matters: presets + tasks before photos (photos FK -> tasks).
    await pushPresets()
    await pushTasks()
    await pushPhotos()
    await processTombstones()
    await pullPresets()
    await pullTasksAndPhotos()
    const at = new Date().toISOString()
    await setMeta('lastSyncAt', at)
    setState({ lastSyncAt: at })
  } catch (e) {
    setState({ lastError: e?.message || String(e) })
  } finally {
    await refreshPending()
    running = false
    setState({ syncing: false })
    if (queued) {
      queued = false
      requestSync()
    }
  }
}

async function refreshPending() {
  try {
    const [t, p, c, m, r, a, tomb] = await Promise.all([
      db.tasks.where('syncStatus').equals(SyncStatus.PENDING).count(),
      db.photos.where('syncStatus').equals(SyncStatus.PENDING).count(),
      db.companies.where('syncStatus').equals(SyncStatus.PENDING).count(),
      db.machines.where('syncStatus').equals(SyncStatus.PENDING).count(),
      db.pieceRates.where('syncStatus').equals(SyncStatus.PENDING).count(),
      db.areas.where('syncStatus').equals(SyncStatus.PENDING).count(),
      db.tombstones.count()
    ])
    setState({ pending: t + p + c + m + r + a + tomb })
  } catch {
    /* ignore */
  }
}

// ---- push ----------------------------------------------------------------

async function pushPhotos() {
  const pending = await db.photos.where('syncStatus').equals(SyncStatus.PENDING).toArray()
  for (const p of pending) {
    if (!p.blob) {
      // Pulled-from-server placeholder with no local bytes — nothing to upload.
      if (p.storagePath) await markSynced(db.photos, p.id, p.updatedAt)
      continue
    }
    const path = p.storagePath || `${p.taskId}/${p.id}.jpg`
    const up = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, p.blob, { upsert: true, contentType: p.blob.type || 'image/jpeg' })
    if (up.error) throw up.error
    const { error } = await supabase.from('photos').upsert(toServerPhoto(p, path))
    if (error) throw error
    // Only finalise if the row hasn't changed underneath us.
    const cur = await db.photos.get(p.id)
    if (cur && cur.updatedAt === p.updatedAt) {
      await db.photos.update(p.id, { storagePath: path, syncStatus: SyncStatus.SYNCED })
    }
  }
}

async function pushTasks() {
  const pending = await db.tasks.where('syncStatus').equals(SyncStatus.PENDING).toArray()
  if (!pending.length) return
  const { error } = await supabase.from('tasks').upsert(pending.map(toServerTask))
  if (error) throw error
  for (const t of pending) await markSynced(db.tasks, t.id, t.updatedAt, { serverId: t.id })
}

async function pushPresets() {
  await pushTable(db.companies, 'companies', toServerCompany)
  await pushTable(db.machines, 'machines', toServerMachine)
  await pushTable(db.pieceRates, 'piece_rates', toServerPieceRate)
  await pushTable(db.areas, 'areas', toServerArea)
}

async function pushTable(table, serverTable, mapper) {
  const pending = await table.where('syncStatus').equals(SyncStatus.PENDING).toArray()
  if (!pending.length) return
  const { error } = await supabase.from(serverTable).upsert(pending.map(mapper))
  if (error) throw error
  for (const row of pending) await markSynced(table, row.id, row.updatedAt)
}

async function markSynced(table, id, expectedUpdatedAt, extra = {}) {
  const cur = await table.get(id)
  if (cur && cur.updatedAt === expectedUpdatedAt) {
    await table.update(id, { syncStatus: SyncStatus.SYNCED, ...extra })
  }
}

async function processTombstones() {
  const tombs = await db.tombstones.toArray()
  for (const t of tombs) {
    if (t.table === 'photos' && t.storagePath) {
      const { error } = await supabase.storage.from(PHOTO_BUCKET).remove([t.storagePath])
      if (error && !/not found/i.test(error.message || '')) throw error
    } else if (t.serverId) {
      const { error } = await supabase.from(t.table).delete().eq('id', t.serverId)
      if (error) throw error
    }
    await db.tombstones.delete(t.id)
  }
}

// ---- pull ----------------------------------------------------------------

async function pullPresets() {
  await pullTable('companies', db.companies, fromServerCompany)
  await pullTable('machines', db.machines, fromServerMachine)
  await pullTable('piece_rates', db.pieceRates, fromServerPieceRate)
  await pullTable('areas', db.areas, fromServerArea)
}

async function pullTable(serverTable, dexieTable, mapper) {
  const cursorKey = `cursor.${serverTable}`
  const cursor = (await getMeta(cursorKey)) || EPOCH
  const { data, error } = await supabase
    .from(serverTable)
    .select('*')
    .gt('updated_at', cursor)
    .order('updated_at', { ascending: true })
    .limit(1000)
  if (error) throw error
  let maxCursor = cursor
  for (const row of data || []) {
    const local = mapper(row)
    if (row.updated_at > maxCursor) maxCursor = row.updated_at
    const existing = await dexieTable.get(local.id)
    // Don't clobber a local edit that hasn't synced yet and is newer.
    if (existing && existing.syncStatus === SyncStatus.PENDING && existing.updatedAt > local.updatedAt) {
      continue
    }
    await dexieTable.put(local)
  }
  if (maxCursor !== cursor) await setMeta(cursorKey, maxCursor)
}

async function pullTasksAndPhotos() {
  // Tasks
  {
    const cursor = (await getMeta('cursor.tasks')) || EPOCH
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .gt('updated_at', cursor)
      .order('updated_at', { ascending: true })
      .limit(1000)
    if (error) throw error
    let maxCursor = cursor
    for (const row of data || []) {
      if (row.updated_at > maxCursor) maxCursor = row.updated_at
      const local = fromServerTask(row)
      const existing = await db.tasks.get(local.id)
      if (existing && existing.syncStatus === SyncStatus.PENDING && existing.updatedAt > local.updatedAt) {
        continue
      }
      await db.tasks.put(local)
    }
    if (maxCursor !== cursor) await setMeta('cursor.tasks', maxCursor)
  }
  // Photos (metadata only; bytes stay in Storage and load on demand)
  {
    const cursor = (await getMeta('cursor.photos')) || EPOCH
    const { data, error } = await supabase
      .from('photos')
      .select('*')
      .gt('updated_at', cursor)
      .order('updated_at', { ascending: true })
      .limit(1000)
    if (error) throw error
    let maxCursor = cursor
    for (const row of data || []) {
      if (row.updated_at > maxCursor) maxCursor = row.updated_at
      const existing = await db.photos.get(row.id)
      if (existing && existing.syncStatus === SyncStatus.PENDING) continue
      await db.photos.put(fromServerPhoto(row, existing?.blob ?? null))
    }
    if (maxCursor !== cursor) await setMeta('cursor.photos', maxCursor)
  }
}
