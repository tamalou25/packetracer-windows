/**
 * Trait pointillé suivant la souris pendant le câblage ou l'envoi d'un PDU simple.
 */
import { ViewportPortal } from '@xyflow/react'
import { useLabStore } from '../../store/lab'
import { useUiStore } from '../../store/ui'
import { ICON_CENTER } from '../../lib/flow'

export function CablePreview({ cursor }: { cursor: { x: number; y: number } | null }) {
  const cableStart = useUiStore((s) => s.cableStart)
  const pduSource = useUiStore((s) => s.pduSource)
  const startId = cableStart?.deviceId ?? pduSource
  const device = useLabStore((s) => (startId ? s.lab.devices[startId] : undefined))
  if (!startId || !device || !cursor) return null
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
