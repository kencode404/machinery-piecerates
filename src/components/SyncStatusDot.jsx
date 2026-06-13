import { SyncStatus } from '../db/models.js'

const MAP = {
  [SyncStatus.SYNCED]: { c: 'bg-green-400', t: 'Synced' },
  [SyncStatus.PENDING]: { c: 'bg-amber-400', t: 'Waiting to sync' },
  [SyncStatus.ERROR]: { c: 'bg-red-400', t: 'Sync error' }
}

export function SyncStatusDot({ status }) {
  const s = MAP[status] || MAP[SyncStatus.PENDING]
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${s.c}`} title={s.t} aria-label={s.t} />
}
