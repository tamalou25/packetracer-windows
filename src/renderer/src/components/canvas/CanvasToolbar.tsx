/**
 * Outils du canvas : sélection, câble, suppression.
 */
import { Cable, MousePointer2, Trash2, type LucideIcon } from 'lucide-react'
import { useUiStore, type Tool } from '../../store/ui'

const TOOLS: { tool: Tool; label: string; icon: LucideIcon; hint: string }[] = [
  { tool: 'select', label: 'Sélection', icon: MousePointer2, hint: 'Sélectionner et déplacer (Échap)' },
  {
    tool: 'cable',
    label: 'Câble',
    icon: Cable,
    hint: 'Relier deux ports : cliquez sur un équipement puis sur un autre'
  },
  {
    tool: 'delete',
    label: 'Supprimer',
    icon: Trash2,
    hint: 'Cliquez sur un équipement ou un câble pour le supprimer'
  }
]

export function CanvasToolbar() {
  const tool = useUiStore((s) => s.tool)
  const setTool = useUiStore((s) => s.setTool)
  const cableStart = useUiStore((s) => s.cableStart)
  return (
    <div className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2">
      <div
        className="flex overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
        role="toolbar"
      >
        {TOOLS.map(({ tool: t, label, icon: Icon, hint }) => (
          <button
            key={t}
            type="button"
            title={hint}
            aria-pressed={tool === t}
            data-testid={`tool-${t}`}
            onClick={() => setTool(t)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition ${
              tool === t ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
      {tool === 'cable' && (
        <span className="rounded-md bg-amber-100 px-2 py-1 text-xs text-amber-800 shadow-sm">
          {cableStart ? 'Cliquez sur le second équipement' : 'Cliquez sur le premier équipement'}
        </span>
      )}
    </div>
  )
}
