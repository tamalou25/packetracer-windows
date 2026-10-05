/**
 * Résultats des PDU simples (coin supérieur gauche du canvas).
 */
import { CircleCheck, CircleX, X } from 'lucide-react'
import { useUiStore } from '../../store/ui'

export function PduList() {
  const results = useUiStore((s) => s.pduResults)
  const clear = useUiStore((s) => s.clearPduResults)
  if (results.length === 0) return null
  return (
    <div
      className="absolute top-14 left-3 z-10 w-72 rounded-lg border border-slate-200 bg-white/95 text-xs shadow-sm"
      data-testid="pdu-list"
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5 font-semibold text-slate-500">
        PDU simples
        <button type="button" onClick={clear} className="rounded p-0.5 hover:bg-slate-100" title="Effacer">
          <X size={12} />
        </button>
      </div>
      <ul className="max-h-48 overflow-y-auto">
        {results.map((r) => (
          <li key={r.id} className="flex items-center gap-2 px-3 py-1">
            {r.success ? (
              <CircleCheck size={13} className="text-green-600" />
            ) : (
              <CircleX size={13} className="text-red-600" />
            )}
            <span className={r.success ? 'text-green-700' : 'text-red-700'}>
              {r.success ? 'Réussi' : 'Échec'}
            </span>
            <span className="truncate text-slate-600">
              {r.source} → {r.target}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
