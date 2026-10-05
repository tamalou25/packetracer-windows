/**
 * Palette d'équipements (en bas de l'écran).
 * Glisser un équipement vers le canvas, ou cliquer puis cliquer sur le canvas.
 */
import { DEVICE_KIND_INFO, DEVICE_KINDS } from '@engine/index'
import { DEVICE_COLORS, DEVICE_ICONS } from '../lib/devices'
import { useUiStore } from '../store/ui'

/** Type MIME utilisé pour le glisser-déposer depuis la palette. */
export const DND_DEVICE_MIME = 'application/x-serverlab-device'

export function Palette() {
  const armed = useUiStore((s) => s.armed)
  const setArmed = useUiStore((s) => s.setArmed)
  return (
    <div className="flex items-center gap-2" role="toolbar" aria-label="Palette d’équipements">
      {DEVICE_KINDS.map((kind) => {
        const Icon = DEVICE_ICONS[kind]
        const info = DEVICE_KIND_INFO[kind]
        const active = armed === kind
        return (
          <button
            key={kind}
            type="button"
            draggable
            data-testid={`palette-${kind}`}
            title={`${info.label} — ${info.description}`}
            aria-pressed={active}
            onDragStart={(e) => {
              e.dataTransfer.setData(DND_DEVICE_MIME, kind)
              e.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={() => setArmed(active ? null : kind)}
            className={`flex w-24 flex-col items-center gap-1 rounded-md border px-2 py-2 transition-colors ${
              active
                ? 'border-accent bg-accent-soft'
                : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2'
            }`}
          >
            <span className={`flex h-9 w-9 items-center justify-center rounded-md ${DEVICE_COLORS[kind]}`}>
              <Icon size={20} strokeWidth={1.75} />
            </span>
            <span className="text-xs font-medium text-fg">{info.label}</span>
          </button>
        )
      })}
    </div>
  )
}
