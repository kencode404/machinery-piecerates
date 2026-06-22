import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAuth } from '../../auth/AuthContext.jsx'
import { getMonthTasks } from '../../db/repo.js'
import { getMeta } from '../../db/database.js'
import { monthKeyOf } from '../../lib/format.js'
import MonthSummary from '../../components/MonthSummary.jsx'

export default function OperatorSummary() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [monthKey, setMonthKey] = useState(monthKeyOf(new Date()))

  const tasks = useLiveQuery(
    () => getMonthTasks({ operatorId: user.operatorId, monthKey }),
    [user.operatorId, monthKey],
    undefined
  )
  const currency = useLiveQuery(() => getMeta('currency', 'RM'), [], 'RM')

  return (
    <div className="pb-4">
      <h1 className="text-lg font-bold text-slate-800">Salary claim</h1>
      <p className="mb-3 text-xs text-slate-400">{user.operatorName}</p>
      <MonthSummary
        tasks={tasks || []}
        monthKey={monthKey}
        onMonthChange={setMonthKey}
        currency={currency}
        onOpenClick={(t) => navigate(`/open/${t.id}`)}
      />
    </div>
  )
}
