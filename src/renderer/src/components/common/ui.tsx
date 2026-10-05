/**
 * Petits composants d'interface réutilisables.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-sky-600 text-white hover:bg-sky-700 disabled:bg-sky-300',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  ghost: 'text-slate-600 hover:bg-slate-100 disabled:text-slate-300'
}

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    />
  )
}

export function Section({
  title,
  children,
  actions
}: {
  title: string
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <section className="border-b border-slate-200 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-600">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  )
}

export const inputClass =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200 disabled:bg-slate-100 disabled:text-slate-500'

/** Pastille colorée d'état. */
export function StatusDot({ status }: { status: 'up' | 'degraded' | 'down' | 'none' }) {
  const color =
    status === 'up'
      ? 'bg-green-500'
      : status === 'degraded'
        ? 'bg-amber-500'
        : status === 'down'
          ? 'bg-red-500'
          : 'bg-slate-300'
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${color}`} />
}
