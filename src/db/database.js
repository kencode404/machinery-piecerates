import Dexie from 'dexie'
import { uuid } from '../lib/uuid.js'
import { hashSecret } from '../lib/crypto.js'

// IndexedDB store. Holds ALL data locally so the app works fully offline.
// Photos are kept as Blobs inside the `photos` store (IndexedDB handles large
// binary data, unlike localStorage which is tiny and text-only).
export const db = new Dexie('machinery_piece_rates')

db.version(1).stores({
  // `id` is a client-generated uuid (stable across sync).
  operators: 'id, name, active, updatedAt, syncStatus',
  pieceRates: 'id, name, active, updatedAt, syncStatus',
  areas: 'id, name, active, updatedAt, syncStatus',
  // Compound indexes speed up the open-tasks list and the monthly summary.
  tasks:
    'id, operatorId, status, syncStatus, monthKey, dayKey, startTime, updatedAt, [operatorId+status], [operatorId+monthKey], [monthKey+status]',
  photos: 'id, taskId, kind, syncStatus, updatedAt',
  // Records deleted locally that still need to be removed from the server.
  tombstones: 'id, table, createdAt',
  // key/value: currency, admin auth, recovery hash, last sync cursor, etc.
  meta: 'key'
})

// v2: Company -> Machine hierarchy. Operators are now a self-typed username
// (no operator accounts); the per-machine PIN gates login. Tasks gain
// company/machine fields and indexes for the new queries.
db.version(2).stores({
  companies: 'id, name, active, updatedAt, syncStatus',
  machines: 'id, companyId, name, active, updatedAt, syncStatus',
  tasks:
    'id, status, syncStatus, monthKey, dayKey, startTime, updatedAt, companyId, machineId, operatorName, [companyId+operatorName+status], [companyId+operatorName+monthKey], [companyId+monthKey]'
})

// v3: the operator "account" is the MACHINE (company + machine), not the typed
// name — so a machine's records are shared regardless of who is signed in.
// Index tasks by machine for the open list and the monthly claim.
db.version(3).stores({
  tasks:
    'id, status, syncStatus, monthKey, dayKey, startTime, updatedAt, companyId, machineId, operatorName, [machineId+status], [machineId+monthKey], [companyId+monthKey]'
})

// ---- meta helpers ---------------------------------------------------------

export async function getMeta(key, fallback = null) {
  const row = await db.meta.get(key)
  return row ? row.value : fallback
}

export async function setMeta(key, value) {
  await db.meta.put({ key, value })
  return value
}

// ---- first-run seed -------------------------------------------------------

/**
 * Seeds a little demo data + defaults the first time the app is opened so the
 * operator login and forms are usable immediately. Idempotent.
 * The demo operator / rates / areas can be edited or deleted by the admin.
 */
export async function seedIfEmpty() {
  // Versioned key so the v2 demo company/machine also seeds on upgraded devices.
  if (await getMeta('seeded.v2')) return

  const now = new Date().toISOString()
  const demoPin = await hashSecret('1234')
  const companyId = uuid()

  await db.transaction('rw', db.companies, db.machines, db.pieceRates, db.areas, db.meta, async () => {
    if ((await db.companies.count()) === 0) {
      await db.companies.add({
        id: companyId,
        name: 'Demo Company',
        active: true,
        updatedAt: now,
        syncStatus: 'pending'
      })
      await db.machines.add({
        id: uuid(),
        companyId,
        name: 'Excavator 1',
        pinHash: demoPin, // demo machine PIN: 1234
        active: true,
        updatedAt: now,
        syncStatus: 'pending'
      })
    }
    if ((await db.pieceRates.count()) === 0) {
      await db.pieceRates.bulkAdd([
        rate('Repair road', 'm', 25, now),
        rate('Clear drain', 'm', 8, now),
        rate('Load & haul soil', 'trip', 60, now)
      ])
    }
    if ((await db.areas.count()) === 0) {
      await db.areas.bulkAdd([area('Zone A', now), area('Zone B', now), area('Main Road', now)])
    }
    if ((await getMeta('currency')) == null) await setMeta('currency', 'RM')
    await setMeta('seeded.v2', true)
  })
}

function rate(name, unit, price, now) {
  return { id: uuid(), name, unit, price, active: true, updatedAt: now, syncStatus: 'pending' }
}

function area(name, now) {
  return { id: uuid(), name, active: true, updatedAt: now, syncStatus: 'pending' }
}

export default db
