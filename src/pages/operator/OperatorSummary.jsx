import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAuth } from '../../auth/AuthContext.jsx'
import { getMonthTasks } from '../../db/repo.js'
import { getMeta } from '../../db/database.js'
import { monthKeyOf } from '../../lib/format.js'
import MonthSummary from '../../components/MonthSummary.jsx'
import { Button, Field, TextInput, Modal } from '../../components/ui.jsx'

export default function OperatorSummary() {
  const { user, updateOperatorName } = useAuth()
  const navigate = useNavigate()
  const [monthKey, setMonthKey] = useState(monthKeyOf(new Date()))
  const [editing, setEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState(user.operatorName || '')

  // Records belong to the machine account, regardless of the current name.
  const tasks = useLiveQuery(
    () => getMonthTasks({ machineId: user.machineId, monthKey }),
    [user.machineId, monthKey],
    undefined
  )
  const currency = useLiveQuery(() => getMeta('currency', 'RM'), [], 'RM')

  function saveName() {
    updateOperatorName(nameDraft)
    setEditing(false)
  }

  return (
    <div className="pb-4">
      <h1 className="text-lg font-bold text-slate-800">Salary claim</h1>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-slate-400">
          {user.machineName} · {user.companyName}
        </p>
        <button
          className="text-xs font-medium text-brand"
          onClick={() => {
            setNameDraft(user.operatorName || '')
            setEditing(true)
          }}
        >
          Name: {user.operatorName} ✎
        </button>
      </div>

      <MonthSummary
        tasks={tasks || []}
        monthKey={monthKey}
        onMonthChange={setMonthKey}
        currency={currency}
        onOpenClick={(t) => navigate(`/open/${t.id}`)}
      />

      <Modal open={editing} onClose={() => setEditing(false)} title="Your name on the claim">
        <div className="space-y-3">
          <Field label="Name" hint="Used on records you create from now on">
            <TextInput value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus />
          </Field>
          <Button full onClick={saveName} disabled={!nameDraft.trim()}>
            Save
          </Button>
        </div>
      </Modal>
    </div>
  )
}
