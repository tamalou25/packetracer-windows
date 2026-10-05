/**
 * Contrôles de vue regroupés avec la minimap (coin inférieur droit) :
 * zoom arrière / niveau / zoom avant, ajustement à la fenêtre, affichage de la minimap.
 */
import { Panel, useReactFlow, useViewport } from '@xyflow/react'
import { Map as MapIcon, Maximize, Minus, Plus } from 'lucide-react'
import { useUiStore } from '../../store/ui'

const ANIMATION = { duration: 150 }

export function ZoomControls() {
  const flow = useReactFlow()
  const { zoom } = useViewport()
  const showMinimap = useUiStore((s) => s.showMinimap)
  const toggleMinimap = useUiStore((s) => s.toggleMinimap)
  const button =
    'flex w-7 items-center justify-center text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg'
  return (
    <Panel position="bottom-right" className="!m-3">
      <div
        className="flex h-7 w-[168px] items-stretch overflow-hidden rounded-md border border-line bg-panel/80 shadow-sm backdrop-blur-sm"
        role="toolbar"
        aria-label="Vue"
      >
        <button
          type="button"
          className={button}
          onClick={() => void flow.zoomOut(ANIMATION)}
          title="Zoom arrière (Ctrl+-)"
          data-testid="zoom-out"
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          className="flex-1 px-1 font-mono text-[11px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          onClick={() => void flow.zoomTo(1, ANIMATION)}
          title="Revenir à 100 %"
          data-testid="zoom-level"
        >
          {Math.round(zoom * 100)} %
        </button>
        <button
          type="button"
          className={button}
          onClick={() => void flow.zoomIn(ANIMATION)}
          title="Zoom avant (Ctrl+=)"
          data-testid="zoom-in"
        >
          <Plus size={14} />
        </button>
        <span className="my-1.5 w-px bg-line" />
        <button
          type="button"
          className={button}
          onClick={() => void flow.fitView({ padding: 0.3, maxZoom: 1.2, duration: 200 })}
          title="Ajuster à la fenêtre (Ctrl+0)"
          data-testid="zoom-fit"
        >
          <Maximize size={13} />
        </button>
        <button
          type="button"
          className={`${button} ${showMinimap ? '!text-accent-text' : ''}`}
          onClick={toggleMinimap}
          aria-pressed={showMinimap}
          title={showMinimap ? 'Masquer la minimap' : 'Afficher la minimap'}
          data-testid="minimap-toggle"
        >
          <MapIcon size={14} />
        </button>
      </div>
    </Panel>
  )
}
