/**
 * Nœud « équipement » du canvas.
 */
import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { PowerOff } from 'lucide-react'
import { useLabStore } from '../../store/lab'
import { DEVICE_COLORS, DEVICE_ICONS } from '../../lib/devices'

export type DeviceNodeData = { deviceId: string }
export type DeviceFlowNode = Node<DeviceNodeData, 'device'>

/** Poignée invisible centrée : les câbles sont tracés de centre à centre. */
const handleClass =
  '!pointer-events-none !absolute !top-7 !left-11 !h-px !w-px !min-h-0 !min-w-0 !border-0 !bg-transparent'

function DeviceNodeComponent({ data, selected }: NodeProps<DeviceFlowNode>) {
  const device = useLabStore((s) => s.lab.devices[data.deviceId])
  if (!device) return null
  const Icon = DEVICE_ICONS[device.kind]
  return (
    <div className="flex w-[88px] flex-col items-center gap-1" data-testid={`device-${device.name}`}>
      <div
        className={`relative flex h-14 w-14 items-center justify-center rounded-md shadow-sm transition ${
          DEVICE_COLORS[device.kind]
        } ${selected ? 'ring-2 ring-accent ring-offset-2 ring-offset-canvas' : ''} ${device.powered ? '' : 'opacity-40 grayscale'}`}
      >
        <Icon size={30} strokeWidth={1.6} />
        {!device.powered && (
          <span
            className="absolute -right-1.5 -bottom-1.5 rounded-full bg-danger p-0.5 text-white"
            title="Éteint"
          >
            <PowerOff size={12} />
          </span>
        )}
      </div>
      <span
        className={`max-w-full truncate rounded px-1.5 text-xs font-semibold ${
          selected ? 'bg-accent text-on-accent' : 'bg-canvas/80 text-fg'
        }`}
      >
        {device.name}
      </span>
      <Handle type="source" position={Position.Top} className={handleClass} isConnectable={false} />
      <Handle type="target" position={Position.Top} className={handleClass} isConnectable={false} />
    </div>
  )
}

export const DeviceNode = memo(DeviceNodeComponent)
