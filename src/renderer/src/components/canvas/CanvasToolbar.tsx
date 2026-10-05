/**
 * Barre d'outils du canvas : icônes seules, infobulles avec raccourci, outil actif mis en évidence.
 */
import { Cable, MousePointer2, Send, Trash2, type LucideIcon } from 'lucide-react'
import { useUiStore, type Tool } from '../../store/ui'
import { Tooltip } from '../common/Tooltip'

export const TOOLS: { tool: Tool; label: string; icon: LucideIcon; shortcut: string }[] = [
  { tool: 'select', label: 'Sélection', icon: MousePointer2, shortcut: 'V' },
  { tool: 'cable', label: 'Câble', icon: Cable, shortcut: 'C' },
  { tool: 'pdu', label: 'PDU simple (ping)', icon: Send, shortcut: 'P' },
  { tool: 'delete', label: 'Supprimer', icon: Trash2, shortcut: 'Suppr' }
]

const HINTS: Partial<Record<Tool, (pending: boolean) => string>> = {
  cable: (started) =>
    started ? 'Choisissez le port du second équipement' : 'Choisissez un port du premier équipement',
  pdu: (started) => (started ? 'Cliquez sur l’équipement de destination' : 'Cliquez sur l’équipement source'),
  delete: () => 'Cliquez sur un équipement ou un câble pour le supprimer'
}

export function CanvasToolbar() {
  const tool = useUiStore((s) => s.tool)
  const setTool = useUiStore((s) => s.setTool)
  const cableStart = useUiStore((s) => s.cableStart)
  const pduSource = useUiStore((s) => s.pduSource)
  const hint = HINTS[tool]?.(tool === 'cable' ? !!cableStart : !!pduSource)
  return (
    <div className="absolute top-2.5 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1.5">
      <div
        className="flex h-8 items-center gap-0.5 rounded-md border border-line bg-panel/90 p-0.5 shadow-sm backdrop-blur-sm"
        role="toolbar"
        aria-label="Outils"
      >
        {TOOLS.map(({ tool: t, label, icon: Icon, shortcut }) => (
          <Tooltip key={t} label={label} shortcut={shortcut}>
            <button
              type="button"
              aria-label={label}
              aria-pressed={tool === t}
              data-testid={`tool-${t}`}
              onClick={() => setTool(t)}
              className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
                tool === t
                  ? t === 'delete'
                    ? 'bg-danger text-white'
                    : 'bg-accent text-on-accent'
                  : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
              }`}
            >
              <Icon size={15} />
            </button>
          </Tooltip>
        ))}
      </div>
      {hint && (
        <span
          className={`rounded-md border bg-panel/95 px-2 py-0.5 text-[11px] shadow-sm ${
            tool === 'delete' ? 'border-danger/40 text-danger' : 'border-accent/40 text-accent-text'
          }`}
          data-testid="tool-hint"
        >
          {hint} · Échap pour annuler
        </span>
      )}
    </div>
  )
}
