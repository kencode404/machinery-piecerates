import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { getMonthTasks, listCompanies, listCompanyOperators } from '../../db/repo.js'
import { getMeta } from '../../db/database.js'
import { monthKeyOf } from '../../lib/format.js'
import MonthSummary from '../../components/MonthSummary.jsx'
import { Card, Select } from '../../components/ui.jsx'

export default function AdminRecords() {
  const navigate = useNavigate()
  const [monthKey, setMonthKey] = useState(monthKeyOf(new Date()))
  const [companyId, setCompanyId] = useState('') // '' = all companies
  const [selectedOps, setSelectedOps] = useState([]) // operator usernames

  const companies = useLiveQuery(() => listCompanies({ includeInactive: true }), [], [])
  const operators = useLiveQuery(
    () => (companyId ? listCompanyOperators(companyId) : Promise.resolve([])),
    [companyId],
    []
  )
  const currency = useLiveQuery(() => getMeta('currency', 'RM'), [], 'RM')
  const tasks = useLiveQuery(
    () => getMonthTasks({ companyId: companyId || null, operatorNames: selectedOps, monthKey }),
    [companyId, selectedOps.join('|'), monthKey],
    undefined
  )

  const toggleOp = (name) =>
    setSelectedOps((p) => (p.includes(name) ? p.filter((n) => n !== name) : [...p, name]))

  const editTask = (t) => navigate(`/admin/task/${t.id}`)

  return (
    <div className="space-y-3 pb-4">
      <h1 className="text-lg font-bold text-slate-800">Records</h1>

      <Card className="space-y-3 p-3">
        <Select
          value={companyId}
          onChange={(e) => {
            setCompanyId(e.target.value)
            setSelectedOps([])
          }}
          className="h-11"
        >
          <option value="">All companies</option>
          {(companies || []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.active ? '' : ' (inactive)'}
            </option>
          ))}
        </Select>

        {companyId && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-500">
              Operators {selectedOps.length ? `(${selectedOps.length} selected)` : '(showing all)'}
            </p>
            <div className="flex flex-wrap gap-2">
              {(operators || []).map((name) => {
                const on = selectedOps.includes(name)
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggleOp(name)}
                    className={`rounded-full border px-3 py-1 text-sm ${
                      on ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white text-slate-600'
                    }`}
                  >
                    {name}
                  </button>
                )
              })}
              {operators && operators.length === 0 && (
                <span className="text-sm text-slate-400">No records in this company yet.</span>
              )}
            </div>
          </div>
        )}
      </Card>

      <MonthSummary
        tasks={tasks || []}
        monthKey={monthKey}
        onMonthChange={setMonthKey}
        currency={currency}
        showOperator
        onRecordClick={editTask}
        onOpenClick={editTask}
      />
    </div>
  )
}
