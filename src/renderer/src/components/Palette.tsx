/**
 * Palette d'équipements (en bas de l'écran).
 * Glisser un équipement vers le canvas, ou cliquer puis cliquer sur le canvas.
 */
import { DEVICE_KIND_INFO, DEVICE_KINDS, type DeviceKind } from '@engine/index'
import { DEVICE_COLORS, DEVICE_ICONS } from '../lib/devices'

/** Type MIME utilisé pour le glisser-déposer depuis la palette. */
export const DND_DEVICE_MIME = 'application/x-serverlab-device'

interface PaletteProps {
  armed: DeviceKind | null
  onArm: (kind: DeviceKind | null) => void
}

export function Palette({ armed, onArm }: PaletteProps) {
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
            onDragStart={(e) => {
              e.dataTransfer.setData(DND_DEVICE_MIME, kind)
              e.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={() => onArm(active ? null : kind)}
            className={`flex w-24 flex-col items-center gap-1 rounded-lg border px-2 py-2 transition ${
              active
                ? 'border-sky-500 bg-sky-50 ring-2 ring-sky-300'
                : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            <span className={`flex h-9 w-9 items-center justify-center rounded-md ${DEVICE_COLORS[kind]}`}>
              <Icon size={20} strokeWidth={1.75} />
            </span>
            <span className="text-xs font-medium text-slate-700">{info.label}</span>
          </button>
        )
      })}
    </div>
  )
}
