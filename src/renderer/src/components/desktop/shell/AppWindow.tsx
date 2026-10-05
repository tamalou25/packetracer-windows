/**
 * Fenêtre d'application du Bureau simulé : barre de titre (déplacement, double-clic pour agrandir),
 * boutons Réduire / Agrandir / Fermer, redimensionnement par les bords, boîtes de dialogue modales.
 */
import { createContext, useContext, useRef, type PointerEvent, type ReactNode } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { useDesktopStore, type DesktopWindow, type WinRect } from '../../../store/desktop'
import type { DesktopApp } from '../apps'

export interface AppWindowApi {
  deviceId: string
  win: DesktopWindow
  close: () => void
}

const WindowContext = createContext<AppWindowApi | null>(null)

/** Fenêtre courante (pour fermer la fenêtre ou ouvrir une boîte de dialogue enfant). */
export function useAppWindow(): AppWindowApi | null {
  return useContext(WindowContext)
}

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const EDGES: { edge: Edge; cls: string }[] = [
  { edge: 'n', cls: 'top-0 left-2 right-2 h-1 cursor-ns-resize' },
  { edge: 's', cls: 'bottom-0 left-2 right-2 h-1 cursor-ns-resize' },
  { edge: 'e', cls: 'right-0 top-2 bottom-2 w-1 cursor-ew-resize' },
  { edge: 'w', cls: 'left-0 top-2 bottom-2 w-1 cursor-ew-resize' },
  { edge: 'ne', cls: 'top-0 right-0 h-2 w-2 cursor-nesw-resize' },
  { edge: 'nw', cls: 'top-0 left-0 h-2 w-2 cursor-nwse-resize' },
  { edge: 'se', cls: 'bottom-0 right-0 h-2 w-2 cursor-nwse-resize' },
  { edge: 'sw', cls: 'bottom-0 left-0 h-2 w-2 cursor-nesw-resize' }
]

const MIN = { w: 320, h: 180 }

interface AppWindowProps {
  deviceId: string
  win: DesktopWindow
  app: DesktopApp
  title: string
  active: boolean
  /** Une boîte de dialogue enfant bloque cette fenêtre. */
  blocked: boolean
  area: { w: number; h: number }
  children: ReactNode
}

export function AppWindow({ deviceId, win, app, title, active, blocked, area, children }: AppWindowProps) {
  const store = useDesktopStore.getState()
  const drag = useRef<{ px: number; py: number; rect: WinRect; edge: Edge | null } | null>(null)
  const Icon = app.icon
  const resizable = !app.dialog
  const maximized = win.maximized && resizable

  const start = (e: PointerEvent<HTMLElement>, edge: Edge | null) => {
    if (e.button !== 0 || maximized) return
    e.stopPropagation()
    drag.current = { px: e.clientX, py: e.clientY, rect: { x: win.x, y: win.y, w: win.w, h: win.h }, edge }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.px
    const dy = e.clientY - d.py
    const r = { ...d.rect }
    if (!d.edge) {
      // La barre de titre reste toujours atteignable
      r.x = Math.max(-r.w + 80, Math.min(area.w - 80, d.rect.x + dx))
      r.y = Math.max(0, Math.min(area.h - 30, d.rect.y + dy))
    } else {
      if (d.edge.includes('e')) r.w = Math.max(MIN.w, d.rect.w + dx)
      if (d.edge.includes('s')) r.h = Math.max(MIN.h, d.rect.h + dy)
      if (d.edge.includes('w')) {
        r.w = Math.max(MIN.w, d.rect.w - dx)
        r.x = d.rect.x + d.rect.w - r.w
      }
      if (d.edge.includes('n')) {
        r.h = Math.max(MIN.h, d.rect.h - dy)
        r.y = Math.max(0, d.rect.y + d.rect.h - r.h)
      }
    }
    store.setRect(deviceId, win.id, r)
  }
  const end = () => {
    drag.current = null
  }

  // Fenêtre ramenée dans la zone visible si le Bureau a été réduit
  const x = Math.max(-win.w + 80, Math.min(win.x, area.w - 80))
  const y = Math.max(0, Math.min(win.y, area.h - 30))
  const style = maximized
    ? { left: 0, top: 0, width: '100%', height: '100%', zIndex: win.z }
    : { left: x, top: y, width: win.w, height: win.h, zIndex: win.z }

  const api: AppWindowApi = { deviceId, win, close: () => store.close(deviceId, win.id) }
  const captionButton = 'flex h-full w-[42px] items-center justify-center text-black/80 transition-colors'

  return (
    <WindowContext.Provider value={api}>
      <div
        className={`absolute flex flex-col border bg-white text-black shadow-[0_8px_28px_rgba(0,0,0,0.32)] ${
          win.minimized ? 'hidden' : ''
        } ${active ? 'border-[#3c7fb1]' : 'border-[#9a9a9a]'}`}
        style={style}
        onPointerDownCapture={() => store.focus(deviceId, win.id)}
        role="dialog"
        aria-label={title}
        data-testid={`app-${win.app}`}
      >
        <div
          className="flex h-[30px] shrink-0 items-center bg-white select-none"
          onPointerDown={(e) => start(e, null)}
          onPointerMove={move}
          onPointerUp={end}
          onDoubleClick={() => resizable && store.toggleMaximize(deviceId, win.id)}
        >
          <Icon size={15} className={`mx-2 shrink-0 ${app.color}`} />
          <span className={`min-w-0 flex-1 truncate text-xs ${active ? 'text-black' : 'text-[#7a7a7a]'}`}>
            {title}
          </span>
          {!app.dialog && (
            <button
              type="button"
              className={`${captionButton} hover:bg-black/10`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => store.minimize(deviceId, win.id)}
              title="Réduire"
              data-testid="window-minimize"
            >
              <Minus size={14} strokeWidth={1.5} />
            </button>
          )}
          {resizable && (
            <button
              type="button"
              className={`${captionButton} hover:bg-black/10`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => store.toggleMaximize(deviceId, win.id)}
              title={maximized ? 'Niveau inférieur' : 'Agrandir'}
              data-testid="window-maximize"
            >
              {maximized ? <Copy size={12} strokeWidth={1.5} /> : <Square size={12} strokeWidth={1.5} />}
            </button>
          )}
          <button
            type="button"
            className={`${captionButton} hover:bg-[#e81123] hover:text-white`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={api.close}
            title="Fermer"
            data-testid="window-close"
          >
            <X size={15} strokeWidth={1.5} />
          </button>
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {children}
          {blocked && (
            // Une boîte de dialogue modale est ouverte : la fenêtre ne répond plus
            <div className="absolute inset-0 z-50" onPointerDown={() => store.focus(deviceId, win.id)} />
          )}
        </div>
        {resizable &&
          !maximized &&
          EDGES.map(({ edge, cls }) => (
            <div
              key={edge}
              className={`absolute ${cls}`}
              onPointerDown={(e) => start(e, edge)}
              onPointerMove={move}
              onPointerUp={end}
            />
          ))}
      </div>
    </WindowContext.Provider>
  )
}
