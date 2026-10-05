/**
 * Outils du canvas : sélection, câble, suppression.
 */
import { Cable, Mail, MousePointer2, Trash2, type LucideIcon } from 'lucide-react'
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
    tool: 'pdu',
    label: 'PDU simple',
    icon: Mail,
    hint: 'Envoyer un ping : cliquez sur la source puis sur la destination'
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
  const pduSource = useUiStore((s) => s.pduSource)
  return (
    <div className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1.5">
      <div className="flex overflow-hidden rounded-md border border-line bg-panel shadow-sm" role="toolbar">
        {TOOLS.map(({ tool: t, label, icon: Icon, hint }) => (
          <button
            key={t}
            type="button"
            title={hint}
            aria-pressed={tool === t}
            data-testid={`tool-${t}`}
            onClick={() => setTool(t)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium whitespace-nowrap transition ${
              tool === t ? 'bg-accent text-on-accent' : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
            }`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
      {tool === 'cable' && (
        <span className="rounded-md border border-warn/30 bg-panel px-2 py-1 text-xs text-warn shadow-sm">
          {cableStart ? 'Cliquez sur le second équipement' : 'Cliquez sur le premier équipement'}
        </span>
      )}
      {tool === 'pdu' && (
        <span className="rounded-md border border-accent/30 bg-panel px-2 py-1 text-xs text-accent-text shadow-sm">
          {pduSource ? 'Cliquez sur l’équipement de destination' : 'Cliquez sur l’équipement source'}
        </span>
      )}
    </div>
  )
}
