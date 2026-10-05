/**
 * Trait pointillé suivant la souris pendant le câblage.
 */
import { ViewportPortal } from '@xyflow/react'
import { useLabStore } from '../../store/lab'
import { useUiStore } from '../../store/ui'
import { ICON_CENTER } from '../../lib/flow'

export function CablePreview({ cursor }: { cursor: { x: number; y: number } | null }) {
  const cableStart = useUiStore((s) => s.cableStart)
  const device = useLabStore((s) => (cableStart ? s.lab.devices[cableStart.deviceId] : undefined))
  if (!cableStart || !device || !cursor) return null
  const x1 = device.position.x + ICON_CENTER.x
  const y1 = device.position.y + ICON_CENTER.y
  return (
    <ViewportPortal>
      <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width={1} height={1}>
        <line
          x1={x1}
          y1={y1}
          x2={cursor.x}
          y2={cursor.y}
          className="stroke-amber-500"
          strokeWidth={2}
          strokeDasharray="6 4"
        />
      </svg>
    </ViewportPortal>
  )
}
