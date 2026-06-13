import { useState } from 'react'
import { buildMonthlySummary } from '../lib/summary.js'
import { monthLabel, shiftMonth, monthKeyOf, formatMoney, formatQty, timeOf } from '../lib/format.js'
import { Card, Badge, EmptyState } from './ui.jsx'
import { IconChevron } from './icons.jsx'
import { SyncStatusDot } from './SyncStatusDot.jsx'

const thisMonth = () => monthKeyOf(new Date())

/**
 * Monthly summary. Same piece rate on the same day is merged into one line;
 * expanding a line reveals the individual records.
 *
 * Props:
 *   tasks         - tasks already scoped to `monthKey`
 *   monthKey, onMonthChange
 *   currency
 *   showOperator  - include operator name on records (admin)
 *   onRecordClick - (task) => void; if set, records are tappable (admin edit)
 *   onOpenClick   - (task) => void; tap a hanging task
 */
export default function MonthSummary({
  tasks,
  monthKey,
  onMonthChange,
  currency = 'RM',
  showOperator = false,
  onRecordClick,
  onOpenClick
}) {
  const summary = buildMonthlySummary(tasks || [], monthKey)
  const atCurrent = monthKey >= thisMonth()

  return (
    <div className="space-y-3">
      {/* Month navigator + total */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <button
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 active:bg-slate-100"
            onClick={() => onMonthChange(shiftMonth(monthKey, -1))}
            aria-label="Previous month"
          >
            <IconChevron width={20} height={20} className="rotate-180" />
          </button>
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-700">{monthLabel(monthKey)}</p>
            <p className="text-2xl font-bold text-slate-900">
              {formatMoney(summary.monthTotalAmount, currency)}
            </p>
          </div>
          <button
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 active:bg-slate-100 disabled:opacity-30"
            onClick={() => onMonthChange(shiftMonth(monthKey, 1))}
            disabled={atCurrent}
            aria-label="Next month"
          >
            <IconChevron width={20} height={20} />
          </button>
        </div>
        <div className="mt-3 flex justify-center gap-4 text-xs text-slate-500">
          <span>{summary.recordCount} records</span>
          <span>·</span>
          <span>{summary.days.length} working days</span>
          {summary.openCount > 0 && (
            <>
              <span>·</span>
              <span className="text-amber-600">{summary.openCount} unfinished</span>
            </>
          )}
        </div>
      </Card>

      {/* Hanging / unfinished tasks */}
      {summary.open.length > 0 && (
        <div>
          <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-amber-600">
            Unfinished tasks
          </p>
          <div className="space-y-2">
            {summary.open.map((t) => (
              <button
                key={t.id}
                onClick={() => onOpenClick?.(t)}
                className="flex w-full items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-left"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-700">
                    Started {timeOf(t.startTime)}
                    {showOperator ? ` · ${t.operatorName}` : ''}
                  </p>
                  <p className="text-xs text-amber-600">Tap to finish</p>
                </div>
                <IconChevron width={18} height={18} className="text-amber-400" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Days */}
      {summary.days.length === 0 ? (
        <EmptyState title="No completed work this month" subtitle="Finished records will appear here, grouped by day." />
      ) : (
        summary.days.map((day) => (
          <DayCard
            key={day.dayKey}
            day={day}
            currency={currency}
            showOperator={showOperator}
            onRecordClick={onRecordClick}
          />
        ))
      )}
    </div>
  )
}

function DayCard({ day, currency, showOperator, onRecordClick }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2">
        <p className="text-sm font-semibold text-slate-700">{dayHeading(day.dayKey)}</p>
        <p className="text-sm font-bold text-slate-900">{formatMoney(day.totalAmount, currency)}</p>
      </div>
      <div className="divide-y divide-slate-100">
        {day.groups.map((g) => (
          <RateGroup
            key={g.rateKey}
            group={g}
            currency={currency}
            showOperator={showOperator}
            onRecordClick={onRecordClick}
          />
        ))}
      </div>
    </Card>
  )
}

function RateGroup({ group, currency, showOperator, onRecordClick }) {
  const [open, setOpen] = useState(false)
  const multiple = group.records.length > 1
  return (
    <div>
      <button
        className="flex w-full items-center justify-between px-4 py-3 text-left active:bg-slate-50"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800">{group.pieceRateName}</p>
          <p className="text-xs text-slate-400">
            {formatQty(group.totalQty, group.unit)}
            {multiple ? ` · ${group.records.length} entries` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-700">{formatMoney(group.totalAmount, currency)}</span>
          <IconChevron
            width={16}
            height={16}
            className={`text-slate-300 transition-transform ${open ? 'rotate-90' : ''}`}
          />
        </div>
      </button>

      {open && (
        <div className="space-y-1 bg-slate-50/60 px-3 pb-3">
          {group.records.map((t) => (
            <RecordRow
              key={t.id}
              task={t}
              currency={currency}
              showOperator={showOperator}
              onClick={onRecordClick ? () => onRecordClick(t) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function RecordRow({ task, currency, showOperator, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-lg border border-slate-100 bg-white px-3 py-2 text-left ${
        onClick ? 'active:bg-slate-100' : 'cursor-default'
      }`}
    >
      <div className="min-w-0">
        <p className="text-sm text-slate-700">
          {timeOf(task.startTime)}
          {task.endTime ? `–${timeOf(task.endTime)}` : ''} · {formatQty(task.quantity, task.unit)}
        </p>
        <p className="truncate text-xs text-slate-400">
          {task.areaName || 'No area'}
          {task.machineName ? ` · ${task.machineName}` : ''}
          {showOperator ? ` · ${task.operatorName}` : ''}
          {task.createdBy === 'admin' ? ' · added by admin' : ''}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-slate-700">{formatMoney(task.amount, currency)}</span>
        <SyncStatusDot status={task.syncStatus} />
      </div>
    </button>
  )
}

function dayHeading(dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' })
}
