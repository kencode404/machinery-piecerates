import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext.jsx'
import { getOpenTasks } from '../../db/repo.js'
import { PhotoById } from '../../components/PhotoThumb.jsx'
import { Card, EmptyState, Button, Badge } from '../../components/ui.jsx'
import { dateTimeOf } from '../../lib/format.js'
import { SyncStatusDot } from '../../components/SyncStatusDot.jsx'
import { IconChevron, IconPlus } from '../../components/icons.jsx'

export default function OpenTasks() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const tasks = useLiveQuery(() => getOpenTasks(user), [user.operatorId], undefined)

  return (
    <div className="space-y-3 pb-4">
      <h1 className="text-lg font-bold text-slate-800">Open tasks</h1>

      <Button full onClick={() => navigate('/open/new')}>
        <IconPlus width={18} height={18} /> Start a task
      </Button>

      {tasks && tasks.length === 0 && (
        <EmptyState
          title="No open tasks"
          subtitle="Start a task and it will wait here until you add the end photo."
        />
      )}

      {(tasks || []).map((t) => (
        <button key={t.id} onClick={() => navigate(`/open/${t.id}`)} className="block w-full text-left">
          <Card className="flex items-center gap-3 p-3 active:bg-slate-50">
            <PhotoById id={t.workPhotoId || t.startPhotoId} className="h-16 w-16 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Badge color="amber">In progress</Badge>
                <SyncStatusDot status={t.syncStatus} />
              </div>
              <p className="mt-1 truncate text-sm font-medium text-slate-700">Started {dateTimeOf(t.startTime)}</p>
              <p className="truncate text-xs text-slate-400">Tap to add the end photo &amp; finish</p>
            </div>
            <IconChevron width={20} height={20} className="text-slate-300" />
          </Card>
        </button>
      ))}
    </div>
  )
}
