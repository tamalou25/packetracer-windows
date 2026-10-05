/**
 * Barre des tâches du Bureau simulé : bouton Démarrer, recherche, applications épinglées et ouvertes,
 * zone de notification (réseau, langue, horloge) et « Afficher le Bureau ».
 */
import { CircleX, Hexagon, Monitor, Search, TriangleAlert } from 'lucide-react'
import { formatClockParts, type HostDevice } from '@engine/index'
import { launch } from '../../../lib/desktop'
import { hostNetwork, type NetState } from '../../../lib/netstatus'
import { activeWindow, useDesktopStore } from '../../../store/desktop'
import { useLabStore } from '../../../store/lab'
import { appInfo, DESKTOP_APPS } from '../apps'

export type ShellMenu = 'start' | 'search' | 'winx' | 'network' | null

interface TaskbarProps {
  device: HostDevice
  menu: ShellMenu
  setMenu: (menu: ShellMenu) => void
  query: string
  setQuery: (query: string) => void
  onSearchEnter: () => void
}

/** Icône réseau de la zone de notification, avec le badge d'état. */
export function NetworkGlyph({ state, size = 18 }: { state: NetState; size?: number }) {
  return (
    <span className="relative inline-flex">
      <Monitor size={size} strokeWidth={1.6} />
      {(state === 'unplugged' || state === 'disabled') && (
        <CircleX
          size={size * 0.62}
          className="absolute -right-1.5 -bottom-1 fill-[#e81123] text-white"
          strokeWidth={2.4}
        />
      )}
      {(state === 'no-network' || state === 'local') && (
        <TriangleAlert
          size={size * 0.62}
          className="absolute -right-1.5 -bottom-1 fill-[#ffcc00] text-black"
          strokeWidth={2.2}
        />
      )}
    </span>
  )
}

export function Taskbar({ device, menu, setMenu, query, setQuery, onSearchEnter }: TaskbarProps) {
  const lab = useLabStore((s) => s.lab)
  const desktop = useDesktopStore((s) => s.desktops[device.id])
  const windows = desktop?.windows ?? []
  const active = activeWindow(desktop)
  const store = useDesktopStore.getState()
  const parts = formatClockParts(lab.clock)
  const net = hostNetwork(lab, device)

  // Applications épinglées puis fenêtres ouvertes (hors boîtes de dialogue enfants)
  const pinned = DESKTOP_APPS.filter((a) => a.pinned?.(device) && a.available(device)).map((a) => a.id)
  const running = windows.filter((w) => !w.parent).map((w) => w.app)
  const buttons = [...new Set([...pinned, ...running])]

  const onAppClick = (appId: string) => {
    const win = windows.find((w) => w.app === appId && !w.parent)
    if (!win) {
      launch(device.id, appId)
      return
    }
    if (active?.id === win.id && !win.minimized) store.minimize(device.id, win.id)
    else store.focus(device.id, win.id)
  }

  const toggle = (m: ShellMenu) => setMenu(menu === m ? null : m)

  return (
    <div
      className="flex h-10 shrink-0 items-stretch bg-[#1f1f1f]/95 text-white select-none"
      data-testid="taskbar"
    >
      <button
        type="button"
        onClick={() => toggle('start')}
        onContextMenu={(e) => {
          e.preventDefault()
          toggle('winx')
        }}
        className={`flex w-12 items-center justify-center hover:bg-white/10 ${menu === 'start' ? 'bg-white/15' : ''}`}
        title="Démarrer (clic droit : menu d’administration)"
        aria-label="Démarrer"
        data-testid="start-button"
      >
        <Hexagon size={18} className="fill-[#4cc2ff] text-[#4cc2ff]" />
      </button>
      <label
        className={`mx-1 my-1 flex w-56 items-center gap-2 px-2 text-xs ${
          menu === 'search' ? 'bg-white text-black' : 'bg-white/10 text-white/70 hover:bg-white/15'
        }`}
      >
        <Search size={14} />
        <input
          value={query}
          onFocus={() => setMenu('search')}
          onChange={(e) => {
            setQuery(e.target.value)
            if (menu !== 'search') setMenu('search')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSearchEnter()
            if (e.key === 'Escape') {
              setQuery('')
              setMenu(null)
              e.currentTarget.blur()
            }
          }}
          placeholder="Taper ici pour rechercher"
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-current"
          data-testid="search-input"
        />
      </label>
      {buttons.map((appId) => {
        const app = appInfo(appId)
        if (!app) return null
        const win = windows.find((w) => w.app === appId && !w.parent)
        const isActive = !!win && active?.id === win.id
        const Icon = app.icon
        return (
          <button
            key={appId}
            type="button"
            onClick={() => onAppClick(appId)}
            title={app.label}
            aria-label={app.label}
            data-testid={`taskbar-${appId}`}
            className={`relative flex w-11 items-center justify-center ${isActive ? 'bg-white/15' : 'hover:bg-white/10'}`}
          >
            <Icon size={19} className={app.color} />
            {win && (
              <span
                className={`absolute bottom-0 h-0.5 ${isActive ? 'inset-x-0.5 bg-[#76b9ed]' : 'inset-x-2.5 bg-white/60'}`}
              />
            )}
          </button>
        )
      })}
      <div className="ml-auto flex items-stretch text-xs">
        <button
          type="button"
          onClick={() => toggle('network')}
          className={`flex w-9 items-center justify-center hover:bg-white/10 ${menu === 'network' ? 'bg-white/15' : ''}`}
          title={net.adapters
            .map((a) => `${a.iface.name} : ${a.label}${a.state === 'local' ? ' (pas d’accès Internet)' : ''}`)
            .join('\n')}
          data-testid="tray-network"
          data-state={net.state}
        >
          <NetworkGlyph state={net.state} size={16} />
        </button>
        <span className="flex items-center px-2 text-white/90">FRA</span>
        <span
          className="flex flex-col items-center justify-center px-2 leading-tight"
          data-testid="tray-clock"
        >
          <span>{parts.time}</span>
          <span>{parts.date}</span>
        </span>
        <button
          type="button"
          onClick={() => store.minimizeAll(device.id)}
          className="w-1.5 border-l border-white/30 hover:bg-white/20"
          title="Afficher le Bureau"
          data-testid="show-desktop"
        />
      </div>
    </div>
  )
}
