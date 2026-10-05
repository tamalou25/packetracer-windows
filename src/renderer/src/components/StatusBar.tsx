/**
 * Barre d'état (24 px, en bas) : contenu du lab, outil actif, zoom, état d'enregistrement,
 * thème et bascule Temps réel / Simulation.
 */
import { useViewport } from '@xyflow/react'
import { Clock, Footprints, Moon, Sun } from 'lucide-react'
import { useLabStore } from '../store/lab'
import { useSimStore } from '../store/sim'
import { useUiStore, type Tool } from '../store/ui'

const TOOL_LABELS: Record<Tool, string> = {
  select: 'Sélection',
  cable: 'Câble',
  pdu: 'PDU simple',
  delete: 'Supprimer'
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`

function SaveState() {
  const dirty = useLabStore((s) => s.dirty)
  const filePath = useLabStore((s) => s.filePath)
  const lastAutosave = useUiStore((s) => s.lastAutosave)
  if (!dirty)
    return (
      <span className="flex items-center gap-1.5" data-testid="status-save">
        <span className="h-1.5 w-1.5 rounded-full bg-ok" />
        {filePath ? 'Enregistré' : 'Nouveau document'}
      </span>
    )
  const time = lastAutosave
    ? new Date(lastAutosave).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : null
  return (
    <span
      className="flex items-center gap-1.5"
      title="Une copie de récupération est écrite toutes les 60 s tant que le document est modifié."
      data-testid="status-save"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-warn" />
      Modifié · {time ? `récupération auto ${time}` : 'récupération auto ≤ 60 s'}
    </span>
  )
}

export function StatusBar() {
  const devices = useLabStore((s) => Object.keys(s.lab.devices).length)
  const links = useLabStore((s) => Object.keys(s.lab.links).length)
  const tool = useUiStore((s) => s.tool)
  const mode = useUiStore((s) => s.mode)
  const theme = useUiStore((s) => s.theme)
  const setMode = useUiStore((s) => s.setMode)
  const pending = useSimStore((s) => s.queue.length)
  const { zoom } = useViewport()

  const segment = 'flex h-full items-center gap-1 px-2 transition-colors'
  return (
    <footer
      className="flex h-6 shrink-0 items-center gap-4 border-t border-line bg-panel pl-3 text-[11px] text-fg-muted"
      data-testid="status-bar"
    >
      <span data-testid="status-counts">
        {plural(devices, 'équipement', 'équipements')} · {plural(links, 'lien', 'liens')}
      </span>
      <span>
        Outil : <span className="text-fg">{TOOL_LABELS[tool]}</span>
      </span>
      {mode === 'simulation' && (
        <span className="text-accent-text">
          {pending > 0
            ? plural(pending, 'opération en attente', 'opérations en attente')
            : 'Aucun paquet en attente'}
        </span>
      )}
      <span className="ml-auto font-mono" title="Niveau de zoom" data-testid="status-zoom">
        {Math.round(zoom * 100)} %
      </span>
      <SaveState />
      <button
        type="button"
        onClick={() => window.serverlab?.setTheme(theme === 'dark' ? 'light' : 'dark')}
        className="flex h-full items-center px-1 hover:text-fg"
        title={theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'}
        data-testid="status-theme"
      >
        {theme === 'dark' ? <Sun size={12} /> : <Moon size={12} />}
      </button>
      <div className="flex h-full items-stretch border-l border-line" role="radiogroup" aria-label="Mode">
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'realtime'}
          data-testid="mode-realtime"
          title="Mode Temps réel (Ctrl+1)"
          onClick={() => setMode('realtime')}
          className={`${segment} ${mode === 'realtime' ? 'bg-ok-soft font-medium text-ok' : 'hover:bg-surface-2 hover:text-fg'}`}
        >
          <Clock size={12} /> Temps réel
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'simulation'}
          data-testid="mode-simulation"
          title="Mode Simulation (Ctrl+2)"
          onClick={() => setMode('simulation')}
          className={`${segment} ${mode === 'simulation' ? 'bg-accent-soft font-medium text-accent-text' : 'hover:bg-surface-2 hover:text-fg'}`}
        >
          <Footprints size={12} /> Simulation
        </button>
      </div>
    </footer>
  )
}
