/**
 * Notifications temporaires (coin inférieur droit).
 */
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import { useUiStore } from '../../store/ui'

export function Toasts() {
  const toasts = useUiStore((s) => s.toasts)
  const dismiss = useUiStore((s) => s.dismissToast)
  return (
    <div
      className="pointer-events-none fixed right-4 bottom-24 z-[300] flex w-96 flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const Icon =
          t.kind === 'error'
            ? CircleAlert
            : t.kind === 'success'
              ? CircleCheck
              : t.kind === 'warning'
                ? TriangleAlert
                : Info
        const color = {
          error: 'border-red-200 bg-red-50 text-red-800',
          success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
          warning: 'border-amber-200 bg-amber-50 text-amber-900',
          info: 'border-slate-200 bg-white text-slate-700'
        }[t.kind]
        return (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            data-testid={`toast-${t.kind}`}
            className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 shadow-lg ${color}`}
          >
            <Icon size={16} className="mt-0.5 shrink-0" />
            <p className="flex-1 text-sm">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="opacity-60 hover:opacity-100"
              title="Fermer"
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
