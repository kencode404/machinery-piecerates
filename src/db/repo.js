// Central data access layer. Every page goes through these functions so that
// derived fields (duration, amount, day/month keys, sync flags) stay consistent
// and every write announces a change for the sync engine to pick up.

import { db } from './database.js'
import {
  TaskStatus,
  SyncStatus,
  PhotoKind,
  CreatedBy,
  GpsSource,
  emptyGeo
} from './models.js'
import { uuid } from '../lib/uuid.js'
import { dayKeyOf, monthKeyOf } from '../lib/format.js'
import { minutesBetween } from '../lib/duration.js'
import { emitChange } from '../sync/bus.js'

const nowISO = () => new Date().toISOString()
const numOrNull = (v) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

/**
 * @param {{blob: Blob, capturedAt: string|null, gps: object}|null} captured
 */
function buildPhoto(id, taskId, kind, captured) {
  return {
    id,
    taskId,
    kind,
    blob: captured?.blob ?? null,
    storagePath: null,
    capturedAt: captured?.capturedAt ?? null,
    gps: captured?.gps ?? emptyGeo(),
    syncStatus: SyncStatus.PENDING,
    updatedAt: nowISO()
  }
}

export function getPhoto(id) {
  return id ? db.photos.get(id) : Promise.resolve(undefined)
}

export function getPhotosForTask(taskId) {
  return db.photos.where('taskId').equals(taskId).toArray()
}

// ---------------------------------------------------------------------------
// Tasks — operator flow
// ---------------------------------------------------------------------------

/**
 * Operator starts a task: at least 1 start-mileage photo + 1 work photo.
 * The task then "hangs" as IN_PROGRESS until completed.
 * @returns {Promise<string>} new task id
 */
export async function startTask({ session, startTime, notes, startPhoto, workPhoto }) {
  const now = nowISO()
  const taskId = uuid()
  const startPhotoId = startPhoto ? uuid() : null
  const workPhotoId = workPhoto ? uuid() : null
  // Operator can edit the start time; otherwise use the first photo's timestamp.
  const startTimeFinal = startTime || startPhoto?.capturedAt || workPhoto?.capturedAt || now

  const task = {
    id: taskId,
    companyId: session.companyId,
    companyName: session.companyName,
    machineId: session.machineId,
    machineName: session.machineName,
    operatorId: null,
    operatorName: session.operatorName,
    status: TaskStatus.IN_PROGRESS,
    createdBy: CreatedBy.OPERATOR,

    startMileage: null,
    startTime: startTimeFinal,
    startGps: startPhoto?.gps || workPhoto?.gps || emptyGeo(),
    startPhotoId,
    workPhotoId,

    endMileage: null,
    endTime: null,
    endGps: emptyGeo(),
    endPhotoId: null,

    durationMinutes: null,

    pieceRateId: null,
    pieceRateName: null,
    unit: null,
    unitPrice: null,
    quantity: null,
    amount: null,

    areaId: null,
    areaName: null,

    notes: notes || '',
    dayKey: dayKeyOf(startTimeFinal),
    monthKey: monthKeyOf(startTimeFinal),

    syncStatus: SyncStatus.PENDING,
    serverId: null,
    createdAt: now,
    updatedAt: now
  }

  await db.transaction('rw', db.tasks, db.photos, async () => {
    await db.tasks.add(task)
    if (startPhoto) await db.photos.add(buildPhoto(startPhotoId, taskId, PhotoKind.START_MILEAGE, startPhoto))
    if (workPhoto) await db.photos.add(buildPhoto(workPhotoId, taskId, PhotoKind.WORK, workPhoto))
  })
  emitChange()
  return taskId
}

/**
 * Operator completes a hanging task: end-mileage photo + piece rate + quantity
 * + area. Duration is auto-derived from start photo time -> end photo time.
 */
export async function completeTask(taskId, { endMileage, endTime, endPhoto, pieceRate, quantity, area, notes }) {
  const task = await db.tasks.get(taskId)
  if (!task) throw new Error('Task not found')

  const now = nowISO()
  const endPhotoId = task.endPhotoId || (endPhoto ? uuid() : null)
  // Operator can edit the end time; otherwise use the end photo's timestamp.
  const endTimeFinal = endTime || endPhoto?.capturedAt || task.endTime || now
  const qty = numOrNull(quantity)
  const unitPrice = pieceRate ? numOrNull(pieceRate.price) : null

  const patch = {
    status: TaskStatus.COMPLETED,
    endMileage: numOrNull(endMileage),
    endTime: endTimeFinal,
    endGps: endPhoto?.gps || task.endGps || emptyGeo(),
    endPhotoId,
    durationMinutes: minutesBetween(task.startTime, endTimeFinal),

    pieceRateId: pieceRate?.id ?? null,
    pieceRateName: pieceRate?.name ?? null,
    unit: pieceRate?.unit ?? null,
    unitPrice,
    quantity: qty,
    amount: qty != null && unitPrice != null ? round2(qty * unitPrice) : null,

    areaId: area?.id ?? null,
    areaName: area?.name ?? null,

    notes: notes ?? task.notes ?? '',
    syncStatus: SyncStatus.PENDING,
    updatedAt: now
  }

  await db.transaction('rw', db.tasks, db.photos, async () => {
    await db.tasks.update(taskId, patch)
    if (endPhoto && endPhotoId) {
      const existing = await db.photos.get(endPhotoId)
      const row = buildPhoto(endPhotoId, taskId, PhotoKind.END_MILEAGE, endPhoto)
      if (existing) await db.photos.put({ ...existing, ...row })
      else await db.photos.add(row)
    }
  })
  emitChange()
}

// ---------------------------------------------------------------------------
// Tasks — admin
// ---------------------------------------------------------------------------

/** Admin adds a (completed) task manually, no photos required. */
export async function addManualTask(input) {
  const now = nowISO()
  const startTime = input.startTime || now
  const endTime = input.endTime || null
  const qty = numOrNull(input.quantity)
  const unitPrice = input.pieceRate ? numOrNull(input.pieceRate.price) : null

  const task = {
    id: uuid(),
    companyId: input.company.id,
    companyName: input.company.name,
    machineId: input.machine?.id ?? null,
    machineName: input.machine?.name ?? null,
    operatorId: null,
    operatorName: (input.operatorName || '').trim(),
    status: TaskStatus.COMPLETED,
    createdBy: CreatedBy.ADMIN,

    startMileage: numOrNull(input.startMileage),
    startTime,
    startGps: input.startGps || { ...emptyGeo(), source: GpsSource.MANUAL },
    startPhotoId: null,
    workPhotoId: null,

    endMileage: numOrNull(input.endMileage),
    endTime,
    endGps: input.endGps || { ...emptyGeo(), source: GpsSource.MANUAL },
    endPhotoId: null,

    durationMinutes: minutesBetween(startTime, endTime),

    pieceRateId: input.pieceRate?.id ?? null,
    pieceRateName: input.pieceRate?.name ?? null,
    unit: input.pieceRate?.unit ?? null,
    unitPrice,
    quantity: qty,
    amount: qty != null && unitPrice != null ? round2(qty * unitPrice) : null,

    areaId: input.area?.id ?? null,
    areaName: input.area?.name ?? null,

    notes: input.notes || '',
    dayKey: dayKeyOf(startTime),
    monthKey: monthKeyOf(startTime),

    syncStatus: SyncStatus.PENDING,
    serverId: null,
    createdAt: now,
    updatedAt: now
  }
  await db.tasks.add(task)
  emitChange()
  return task.id
}

/**
 * Admin edits any fields of a task (times, GPS, mileage, quantity, rate, area).
 * Pass a partial patch; derived fields are recomputed from the merged result.
 */
export async function updateTask(taskId, patch) {
  const task = await db.tasks.get(taskId)
  if (!task) throw new Error('Task not found')

  const merged = { ...task, ...patch }
  merged.durationMinutes = minutesBetween(merged.startTime, merged.endTime)
  const baseTime = merged.startTime || merged.createdAt
  merged.dayKey = dayKeyOf(baseTime)
  merged.monthKey = monthKeyOf(baseTime)
  merged.amount =
    merged.quantity != null && merged.unitPrice != null
      ? round2(Number(merged.quantity) * Number(merged.unitPrice))
      : null
  merged.updatedAt = nowISO()
  merged.syncStatus = SyncStatus.PENDING

  await db.tasks.put(merged)
  emitChange()
  return merged
}

export async function deleteTask(taskId) {
  const task = await db.tasks.get(taskId)
  await db.transaction('rw', db.tasks, db.photos, db.tombstones, async () => {
    const photos = await db.photos.where('taskId').equals(taskId).toArray()
    if (task?.serverId) {
      await db.tombstones.put({
        id: uuid(),
        table: 'tasks',
        serverId: task.serverId,
        createdAt: nowISO()
      })
    }
    for (const p of photos) {
      if (p.storagePath) {
        await db.tombstones.put({
          id: uuid(),
          table: 'photos',
          storagePath: p.storagePath,
          createdAt: nowISO()
        })
      }
    }
    await db.photos.where('taskId').equals(taskId).delete()
    await db.tasks.delete(taskId)
  })
  emitChange()
}

// ---------------------------------------------------------------------------
// Task queries
// ---------------------------------------------------------------------------

export function getTask(id) {
  return db.tasks.get(id)
}

/**
 * Hanging (IN_PROGRESS) tasks for the logged-in operator (same company + typed
 * username), newest first. Machine can differ between sessions, so it is not
 * part of the filter.
 */
export async function getOpenTasks(session) {
  // Records belong to the MACHINE account (not the typed name).
  if (!session?.machineId) return []
  const rows = await db.tasks
    .where('[machineId+status]')
    .equals([session.machineId, TaskStatus.IN_PROGRESS])
    .toArray()
  return rows.sort((a, b) => (b.startTime || '').localeCompare(a.startTime || ''))
}

/** All in-progress tasks across everyone (admin), newest first. */
export async function getAllOpenTasks() {
  const rows = await db.tasks.where('status').equals(TaskStatus.IN_PROGRESS).toArray()
  return rows.sort((a, b) => (b.startTime || '').localeCompare(a.startTime || ''))
}

/**
 * Tasks for a month.
 *  - machineId  -> that machine's records (operator's own monthly claim)
 *  - companyId  -> whole company (admin); optionally narrow by operatorNames
 *  - neither    -> every company (admin "all")
 */
export async function getMonthTasks({ companyId, machineId, operatorName, operatorNames, monthKey }) {
  let rows
  if (machineId) {
    rows = await db.tasks.where('[machineId+monthKey]').equals([machineId, monthKey]).toArray()
  } else if (companyId) {
    rows = await db.tasks.where('[companyId+monthKey]').equals([companyId, monthKey]).toArray()
  } else {
    rows = await db.tasks.where('monthKey').equals(monthKey).toArray()
  }
  if (operatorName) rows = rows.filter((t) => t.operatorName === operatorName)
  if (operatorNames && operatorNames.length) {
    const set = new Set(operatorNames)
    rows = rows.filter((t) => set.has(t.operatorName))
  }
  return rows
}

/** Distinct operator usernames that have records in a company (for admin filter). */
export async function listCompanyOperators(companyId) {
  if (!companyId) return []
  const rows = await db.tasks.where('companyId').equals(companyId).toArray()
  const names = [...new Set(rows.map((t) => (t.operatorName || '').trim()).filter(Boolean))]
  return names.sort((a, b) => a.localeCompare(b))
}

// ---------------------------------------------------------------------------
// Presets: piece rates, areas, operators
// ---------------------------------------------------------------------------

export async function listPieceRates({ includeInactive = false } = {}) {
  const all = await db.pieceRates.orderBy('name').toArray()
  return includeInactive ? all : all.filter((r) => r.active)
}

export async function upsertPieceRate(input) {
  const now = nowISO()
  const row = {
    id: input.id || uuid(),
    name: (input.name || '').trim(),
    unit: (input.unit || '').trim(),
    price: numOrNull(input.price) ?? 0,
    active: input.active !== false,
    updatedAt: now,
    syncStatus: SyncStatus.PENDING
  }
  await db.pieceRates.put(row)
  emitChange()
  return row
}

export async function deletePieceRate(id) {
  await tombstoneAndDelete(db.pieceRates, 'piece_rates', id)
}

export async function listAreas({ includeInactive = false } = {}) {
  const all = await db.areas.orderBy('name').toArray()
  return includeInactive ? all : all.filter((a) => a.active)
}

export async function upsertArea(input) {
  const now = nowISO()
  const row = {
    id: input.id || uuid(),
    name: (input.name || '').trim(),
    active: input.active !== false,
    updatedAt: now,
    syncStatus: SyncStatus.PENDING
  }
  await db.areas.put(row)
  emitChange()
  return row
}

export async function deleteArea(id) {
  await tombstoneAndDelete(db.areas, 'areas', id)
}

// ---- Companies ----
export async function listCompanies({ includeInactive = false } = {}) {
  const all = await db.companies.orderBy('name').toArray()
  return includeInactive ? all : all.filter((c) => c.active)
}

export function getCompany(id) {
  return id ? db.companies.get(id) : Promise.resolve(undefined)
}

export async function upsertCompany(input) {
  const now = nowISO()
  const row = {
    id: input.id || uuid(),
    name: (input.name || '').trim(),
    active: input.active !== false,
    updatedAt: now,
    syncStatus: SyncStatus.PENDING
  }
  await db.companies.put(row)
  emitChange()
  return row
}

export async function deleteCompany(id) {
  await tombstoneAndDelete(db.companies, 'companies', id)
}

// ---- Machines (PIN lives here — login is per machine) ----
export async function listMachines({ companyId, includeInactive = false } = {}) {
  let all = await db.machines.orderBy('name').toArray()
  if (companyId) all = all.filter((m) => m.companyId === companyId)
  return includeInactive ? all : all.filter((m) => m.active)
}

export function getMachine(id) {
  return id ? db.machines.get(id) : Promise.resolve(undefined)
}

export async function upsertMachine(input) {
  const existing = input.id ? await db.machines.get(input.id) : null
  const now = nowISO()
  const row = {
    id: input.id || uuid(),
    companyId: input.companyId ?? existing?.companyId ?? null,
    name: (input.name || '').trim(),
    // pinHash set separately via setMachinePin; keep existing if not provided
    pinHash: input.pinHash ?? existing?.pinHash ?? null,
    active: input.active !== false,
    updatedAt: now,
    syncStatus: SyncStatus.PENDING
  }
  await db.machines.put(row)
  emitChange()
  return row
}

export async function setMachinePin(id, pinHash) {
  await db.machines.update(id, { pinHash, updatedAt: nowISO(), syncStatus: SyncStatus.PENDING })
  emitChange()
}

export async function deleteMachine(id) {
  await tombstoneAndDelete(db.machines, 'machines', id)
}

async function tombstoneAndDelete(table, serverTable, id) {
  const row = await table.get(id)
  await db.transaction('rw', table, db.tombstones, async () => {
    if (row) {
      await db.tombstones.put({
        id: uuid(),
        table: serverTable,
        serverId: id,
        createdAt: nowISO()
      })
    }
    await table.delete(id)
  })
  emitChange()
}

// ---------------------------------------------------------------------------
// Sync status helpers
// ---------------------------------------------------------------------------

export async function countPending() {
  const [tasks, photos] = await Promise.all([
    db.tasks.where('syncStatus').equals(SyncStatus.PENDING).count(),
    db.photos.where('syncStatus').equals(SyncStatus.PENDING).count()
  ])
  return tasks + photos
}
