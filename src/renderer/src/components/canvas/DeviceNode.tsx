/**
 * Nœud « équipement » du canvas : carte compacte (56 px) sur la surface du thème,
 * icône monochrome, liseré de la couleur de catégorie, LED d'état en coin,
 * nom et adresse IP principale sous le nœud.
 */
import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { useLabStore } from '../../store/lab'
import { DEVICE_ICONS, KIND_STRIPE } from '../../lib/devices'
import { deviceHealth, primaryAddress, type DeviceHealth } from '../../lib/health'

export type DeviceNodeData = { deviceId: string }
export type DeviceFlowNode = Node<DeviceNodeData, 'device'>

/** Poignée invisible centrée sur la carte : les câbles sont tracés de centre à centre. */
const handleClass =
  '!pointer-events-none !absolute !top-7 !left-7 !h-px !w-px !min-h-0 !min-w-0 !border-0 !bg-transparent'

const LED: Record<DeviceHealth, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  off: 'bg-danger',
  idle: 'bg-fg-subtle'
}

const IP_TONE = { normal: 'text-fg-muted', warn: 'text-warn', none: 'text-fg-subtle' } as const

function DeviceNodeComponent({ data, selected }: NodeProps<DeviceFlowNode>) {
  const lab = useLabStore((s) => s.lab)
  const device = lab.devices[data.deviceId]
  if (!device) return null
  const Icon = DEVICE_ICONS[device.kind]
  const health = deviceHealth(lab, device)
  const ip = primaryAddress(lab, device)
  return (
    <div className="relative h-14 w-14" data-testid={`device-${device.name}`} data-health={health.status}>
      <div
        className={`relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-md border bg-surface shadow-xs transition-colors ${
          selected ? 'border-accent ring-1 ring-accent' : 'border-line-strong hover:border-fg-subtle'
        } ${device.powered ? '' : 'opacity-50'}`}
      >
        <span className={`absolute inset-y-0 left-0 w-[3px] ${KIND_STRIPE[device.kind]}`} />
        <Icon size={26} strokeWidth={1.5} className="text-fg-muted" />
      </div>
      <span
        className={`absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full ring-2 ring-canvas ${LED[health.status]}`}
        title={health.label}
        data-testid="device-led"
      />
      <div className="pointer-events-none absolute top-full left-1/2 mt-1 flex -translate-x-1/2 flex-col items-center leading-tight whitespace-nowrap">
        <span
          className={`max-w-36 truncate rounded bg-canvas/85 px-1 text-xs font-medium ${selected ? 'text-accent-text' : 'text-fg'}`}
        >
          {device.name}
        </span>
        {ip && (
          <span className={`rounded bg-canvas/85 px-1 font-mono text-[10.5px] ${IP_TONE[ip.tone]}`}>
            {ip.text}
            {ip.more > 0 && <span className="text-fg-subtle"> +{ip.more}</span>}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Top} className={handleClass} isConnectable={false} />
      <Handle type="target" position={Position.Top} className={handleClass} isConnectable={false} />
    </div>
  )
}

export const DeviceNode = memo(DeviceNodeComponent)
