import { useState } from 'react'
import { evalExpr, formatResult } from '../lib/expr.js'

const inputBase =
  'w-full rounded-xl border border-slate-300 bg-white px-3.5 h-12 text-slate-900 placeholder:text-slate-400 ' +
  'focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:bg-slate-100'

// Calculator-style numeric field. Type an arithmetic expression (e.g. "5+5+10-6");
// while focused it shows the raw formula, on blur it shows the computed total —
// like a spreadsheet cell. `value` is the raw formula string; `onChange(raw)`
// reports it. Read the numeric result with evalExpr(value) when saving.
export function QuantityInput({ value = '', onChange, className = '', ...props }) {
  const [focused, setFocused] = useState(false)
  const result = evalExpr(value)
  // Focused → the formula; blurred → the total (or the raw text if it isn't a
  // valid expression yet, so a half-typed value is never hidden).
  const shown = focused ? value : result != null ? formatResult(result) : value
  return (
    <input
      {...props}
      type="text"
      inputMode="text"
      autoComplete="off"
      autoCapitalize="off"
      spellCheck={false}
      className={`${inputBase} ${className}`}
      value={shown}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => onChange?.(e.target.value)}
    />
  )
}
