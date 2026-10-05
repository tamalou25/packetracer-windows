/**
 * Fenêtre flottante d'un équipement (double-clic) avec onglets Config / Bureau / Console.
 */
import { useRef, type PointerEvent } from 'react'
import { Monitor, Settings, SquareTerminal, X, type LucideIcon } from 'lucide-react'
import { DEVICE_KIND_INFO } from '@engine/index'
import { useLabStore } from '../../store/lab'
import { useUiStore, type DeviceTab, type DeviceWindowState } from '../../store/ui'
import { DEVICE_COLORS, DEVICE_ICONS } from '../../lib/devices'
import { ConfigTab } from './ConfigTab'
import { ConsoleTab } from '../console/ConsoleTab'
import { DesktopTab } from '../desktop/DesktopTab'
import { isHostDevice } from '@engine/index'

const TABS: { id: DeviceTab; label: string; icon: LucideIcon }[] = [
  { id: 'config', label: 'Config', icon: Settings },
  { id: 'desktop', label: 'Bureau', icon: Monitor },
  { id: 'console', label: 'Console', icon: SquareTerminal }
]

export function DeviceWindow({ win }: { win: DeviceWindowState }) {
  const device = useLabStore((s) => s.lab.devices[win.deviceId])
  const { closeWindow, focusWindow, moveWindow, setWindowTab } = useUiStore.getState()
  const drag = useRef<{ dx: number; dy: number } | null>(null)

  if (!device) return null
  const Icon = DEVICE_ICONS[device.kind]
  const isHost = device.kind === 'server' || device.kind === 'client'
  const tabs = isHost ? TABS : TABS.filter((t) => t.id === 'config')
  const tab = tabs.some((t) => t.id === win.tab) ? win.tab : 'config'

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    drag.current = { dx: e.clientX - win.x, dy: e.clientY - win.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    const x = Math.max(0, Math.min(window.innerWidth - 120, e.clientX - drag.current.dx))
    const y = Math.max(0, Math.min(window.innerHeight - 60, e.clientY - drag.current.dy))
    moveWindow(win.deviceId, x, y)
  }
  const onPointerUp = () => {
    drag.current = null
  }

  return (
    <div
      className="pointer-events-auto absolute flex h-[620px] w-[880px] flex-col overflow-hidden rounded-md border border-line-strong bg-panel text-fg shadow-lg"
      style={{ left: win.x, top: win.y, zIndex: 100 + win.z }}
      onPointerDownCapture={() => focusWindow(win.deviceId)}
      role="dialog"
      aria-label={`${device.name} — ${DEVICE_KIND_INFO[device.kind].label}`}
      data-testid={`device-window-${device.name}`}
    >
      <div
        className="flex cursor-move items-center gap-2 border-b border-line bg-panel px-3 py-1.5 text-fg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span className={`flex h-6 w-6 items-center justify-center rounded-md ${DEVICE_COLORS[device.kind]}`}>
          <Icon size={14} />
        </span>
        <span className="text-sm font-semibold">{device.name}</span>
        <span className="text-xs text-fg-muted">— {DEVICE_KIND_INFO[device.kind].label}</span>
        <button
          type="button"
          className="ml-auto rounded p-1 text-fg-muted hover:bg-danger hover:text-white"
          onClick={() => closeWindow(win.deviceId)}
          title="Fermer"
          data-testid="close-device-window"
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex border-b border-line bg-panel px-2" role="tablist">
        {tabs.map(({ id, label, icon: TabIcon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            data-testid={`tab-${id}`}
            onClick={() => setWindowTab(win.deviceId, id)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-xs font-medium ${
              tab === id ? 'border-accent text-fg' : 'border-transparent text-fg-subtle hover:text-fg-muted'
            }`}
          >
            <TabIcon size={14} /> {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden bg-surface">
        {tab === 'config' && <ConfigTab device={device} />}
        {tab === 'desktop' &&
          isHostDevice(device) &&
          (device.powered ? <DesktopTab device={device} /> : <Placeholder text="L’ordinateur est éteint." />)}
        {tab === 'console' &&
          isHostDevice(device) &&
          (device.powered ? <ConsoleTab device={device} /> : <Placeholder text="L’ordinateur est éteint." />)}
      </div>
    </div>
  )
}

function Placeholder({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center p-8 text-center text-fg-subtle">{text}</div>
}

/** Calque contenant toutes les fenêtres d'équipements ouvertes. */
export function DeviceWindows() {
  const windows = useUiStore((s) => s.windows)
  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      {windows.map((w) => (
        <DeviceWindow key={w.deviceId} win={w} />
      ))}
    </div>
  )
}
