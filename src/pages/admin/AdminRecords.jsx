import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { getMonthTasks, listOperators, listCompanies, isMonthLocked } from '../../db/repo.js'
import { getMeta } from '../../db/database.js'
import { monthKeyOf } from '../../lib/format.js'
import { useAuth } from '../../auth/AuthContext.jsx'
import MonthSummary from '../../components/MonthSummary.jsx'
import { Button, Card, Select, EmptyState } from '../../components/ui.jsx'
import { IconPlus, IconLock } from '../../components/icons.jsx'

// Remember the last operator tab on THIS device (per-browser, not synced), so a
// fresh visit / reload of Records reopens the operator the admin was working on
// instead of snapping back to the first tab. Per-device on purpose: if the admin
// account is used on several computers, each keeps its own tab independently.
const LAST_OP_KEY = 'mpr.adminRecordsOperator'
const readLastOperator = () => {
  try {
    return localStorage.getItem(LAST_OP_KEY) || ''
  } catch {
    return ''
  }
}
const writeLastOperator = (id) => {
  try {
    localStorage.setItem(LAST_OP_KEY, id)
  } catch {
    /* private mode / storage disabled — skip */
  }
}

export default function AdminRecords() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const isSite = user.role === 'siteadmin'
  const [searchParams] = useSearchParams()
  const requestedOpId = searchParams.get('operator') || '' // returning from add/edit
  // No ?operator= in the URL (a fresh visit / reload) → fall back to the operator
  // this device last had open, so the admin stays put. requestedOpId still wins
  // when present (e.g. returning from add/edit on a specific operator).
  const initialOpId = requestedOpId || readLastOperator()
  // Returning from add/edit also restores the month that was being viewed, so the
  // admin keeps editing that operator in place rather than bouncing to this month.
  const requestedMonth = searchParams.get('month') || ''
  const [monthKey, setMonthKey] = useState(
    /^\d{4}-\d{2}$/.test(requestedMonth) ? requestedMonth : monthKeyOf(new Date())
  )
  const [companyId, setCompanyId] = useState('') // '' = all companies (system admin only)
  const [activeOpId, setActiveOpId] = useState(initialOpId) // the operator tab in view

  const companies = useLiveQuery(() => listCompanies({ includeInactive: true }), [], [])
  // Default undefined so "still loading" is distinguishable from "none" — we must
  // not reset the active tab while the list hasn't arrived yet.
  const operators = useLiveQuery(() => listOperators({ includeInactive: true }), [], undefined)
  const currency = useLiveQuery(() => getMeta('currency', 'RM'), [], 'RM')
  const operatorsLoaded = operators !== undefined

  // HQ admin must pick a company. If we returned from "Add work", open that
  // operator's company so their tab is still in view; otherwise the first one.
  useEffect(() => {
    if (isSite || companyId || !companies || !companies.length) return
    if (initialOpId) {
      if (!operatorsLoaded) return // wait so we can read the operator's company
      const op = operators.find((o) => o.id === initialOpId)
      if (op?.companyId) return setCompanyId(op.companyId)
    }
    setCompanyId(companies[0].id)
  }, [companies, companyId, isSite, initialOpId, operators, operatorsLoaded])

  // Site admins are locked to their own company.
  const effectiveCompanyId = isSite ? user.companyId : companyId

  // Worker tabs: real operators (not site admins), scoped to the company.
  const shownOperators = (operators || []).filter(
    (o) => !o.isSiteAdmin && (effectiveCompanyId ? o.companyId === effectiveCompanyId : true)
  )

  // Keep the active tab valid as the list/company changes. Only act once the
  // operators have loaded, otherwise we'd clear the requested tab mid-load and
  // fall back to the first operator.
  useEffect(() => {
    if (!operatorsLoaded) return
    if (!shownOperators.length) {
      if (activeOpId) setActiveOpId('')
      return
    }
    if (!shownOperators.some((o) => o.id === activeOpId)) {
      setActiveOpId(shownOperators[0].id)
    }
  }, [operatorsLoaded, shownOperators, activeOpId])

  // Persist the active tab on this device so the next visit/reload reopens it.
  useEffect(() => {
    if (activeOpId) writeLastOperator(activeOpId)
  }, [activeOpId])

  const liveTasks = useLiveQuery(
    () => (activeOpId ? getMonthTasks({ operatorId: activeOpId, monthKey }) : Promise.resolve([])),
    [activeOpId, monthKey],
    undefined
  )

  // Keep the previous data on screen while the next query resolves, so
  // switching tabs / months doesn't flash empty.
  const [tasksCache, setTasksCache] = useState([])
  useEffect(() => {
    if (liveTasks !== undefined) setTasksCache(liveTasks)
  }, [liveTasks])

  const locked = useLiveQuery(() => isMonthLocked(monthKey), [monthKey], false)
  const editTask = (t) => navigate(`/admin/task/${t.id}`)

  return (
    <div className="space-y-3 pb-4">
      <h1 className="text-lg font-bold text-slate-800">Records</h1>

      <Card className="overflow-hidden">
        {!isSite && (
          <div className="p-3 pb-0">
            <Select
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value)
                setActiveOpId('')
              }}
              className="h-11"
            >
              {(companies || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.active ? '' : ' (inactive)'}
                </option>
              ))}
            </Select>
          </div>
        )}

        {/* Operator tabs */}
        <div className={`flex gap-1 overflow-x-auto overflow-y-hidden border-b border-slate-200 px-2 ${isSite ? 'pt-1' : 'mt-2'}`}>
          {shownOperators.map((o) => {
            const on = o.id === activeOpId
            return (
              <button
                key={o.id}
                onClick={() => setActiveOpId(o.id)}
                className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                  on ? 'border-brand text-brand' : 'border-transparent text-slate-500'
                }`}
              >
                {o.name}
                {o.active ? '' : ' ·'}
              </button>
            )
          })}
          {shownOperators.length === 0 && (
            <span className="px-3 py-2.5 text-sm text-slate-400">No operators</span>
          )}
        </div>
      </Card>

      {activeOpId ? (
        <>
          {locked ? (
            <div className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700">
              <IconLock width={16} height={16} /> This month is locked — records can’t be added or edited.
            </div>
          ) : (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => navigate(`/admin/add?operator=${activeOpId}&month=${monthKey}`)}>
                <IconPlus width={18} height={18} /> Add work
              </Button>
            </div>
          )}
          <MonthSummary
            tasks={tasksCache}
            monthKey={monthKey}
            onMonthChange={setMonthKey}
            currency={currency}
            showOperator={false}
            onRecordClick={editTask}
            onOpenClick={editTask}
          />
        </>
      ) : (
        <EmptyState title="No operator selected" subtitle="Add operators in Settings to see their records." />
      )}
    </div>
  )
}
