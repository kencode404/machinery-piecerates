import { useNavigate } from 'react-router-dom'
import { IconBack } from './icons.jsx'

export default function PageHeader({ title, subtitle, onBack, right }) {
  const navigate = useNavigate()
  return (
    <div className="mb-3 flex items-center gap-2">
      <button
        onClick={() => (onBack ? onBack() : navigate(-1))}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-600 active:bg-slate-100"
        aria-label="Back"
      >
        <IconBack width={22} height={22} />
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-bold text-slate-800">{title}</h1>
        {subtitle && <p className="truncate text-xs text-slate-400">{subtitle}</p>}
      </div>
      {right}
    </div>
  )
}
