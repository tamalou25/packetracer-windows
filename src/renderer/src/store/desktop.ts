/**
 * Bureau simulé de chaque ordinateur : fenêtres ouvertes (position, taille, empilement),
 * verrouillage de la session et applications lancées à l'ouverture de session.
 * État d'interface uniquement : rien n'est enregistré dans le fichier .slab.
 */
import { create } from 'zustand'

export interface WinRect {
  x: number
  y: number
  w: number
  h: number
}

export interface DesktopWindow extends WinRect {
  /** Identifiant unique sur ce bureau : application, plus son paramètre éventuel. */
  id: string
  app: string
  /** Paramètre de l'application (ex. identifiant de la carte réseau). */
  arg?: string
  /** Fenêtre parente, bloquée tant que cette boîte de dialogue est ouverte. */
  parent?: string
  z: number
  minimized: boolean
  maximized: boolean
}

/** Message système affiché au centre du Bureau (restriction, commande introuvable…). */
export interface DesktopNotice {
  title: string
  message: string
  kind: 'error' | 'warning' | 'info'
}

export interface DeviceDesktop {
  windows: DesktopWindow[]
  notice: DesktopNotice | null
  zTop: number
  /** Démarrage connu (horloge du lab) : un redémarrage ferme tout et verrouille la session. */
  boot: number | null
  locked: boolean
  /** Applications de démarrage déjà lancées pour la session en cours. */
  autoStarted: boolean
}

export interface OpenRequest {
  app: string
  arg?: string
  parent?: string
  size: { w: number; h: number }
  maximized?: boolean
  /** Taille de la zone de bureau (pour centrer et borner la fenêtre). */
  area: { w: number; h: number }
}

const EMPTY: DeviceDesktop = {
  windows: [],
  notice: null,
  zTop: 0,
  boot: null,
  locked: false,
  autoStarted: false
}

export function windowId(app: string, arg?: string): string {
  return arg ? `${app}:${arg}` : app
}

/** Fenêtre active : la plus haute parmi celles qui ne sont pas réduites. */
export function activeWindow(desktop: DeviceDesktop | undefined): DesktopWindow | null {
  if (!desktop) return null
  let best: DesktopWindow | null = null
  for (const w of desktop.windows) if (!w.minimized && (!best || w.z > best.z)) best = w
  return best
}

/** Descendants d'une fenêtre (boîtes de dialogue ouvertes depuis elle). */
function descendants(windows: DesktopWindow[], id: string): Set<string> {
  const out = new Set<string>([id])
  let grew = true
  while (grew) {
    grew = false
    for (const w of windows)
      if (w.parent && out.has(w.parent) && !out.has(w.id)) {
        out.add(w.id)
        grew = true
      }
  }
  return out
}

interface DesktopStore {
  desktops: Record<string, DeviceDesktop>
  /** Ouvre (ou ramène au premier plan) une fenêtre ; renvoie son identifiant. */
  open: (deviceId: string, req: OpenRequest) => string
  close: (deviceId: string, winId: string) => void
  focus: (deviceId: string, winId: string) => void
  minimize: (deviceId: string, winId: string) => void
  toggleMaximize: (deviceId: string, winId: string) => void
  setRect: (deviceId: string, winId: string, rect: WinRect) => void
  minimizeAll: (deviceId: string) => void
  /** Aligne le bureau sur le démarrage de l'ordinateur (redémarrage : tout est fermé, session verrouillée). */
  syncBoot: (deviceId: string, bootedAt: number) => void
  setLocked: (deviceId: string, locked: boolean) => void
  /** Fermeture de session : toutes les fenêtres sont fermées. */
  closeAll: (deviceId: string) => void
  markAutoStarted: (deviceId: string) => void
  showNotice: (deviceId: string, notice: DesktopNotice | null) => void
  removeDevice: (deviceId: string) => void
  reset: () => void
}

export const useDesktopStore = create<DesktopStore>()((set, get) => {
  const update = (deviceId: string, fn: (d: DeviceDesktop) => DeviceDesktop) =>
    set((s) => ({ desktops: { ...s.desktops, [deviceId]: fn(s.desktops[deviceId] ?? EMPTY) } }))

  return {
    desktops: {},

    open: (deviceId, req) => {
      const id = windowId(req.app, req.arg)
      update(deviceId, (d) => {
        const z = d.zTop + 1
        const existing = d.windows.find((w) => w.id === id)
        if (existing)
          return {
            ...d,
            zTop: z,
            windows: d.windows.map((w) => (w.id === id ? { ...w, z, minimized: false } : w))
          }
        const w = Math.max(240, Math.min(req.size.w, req.area.w - 8))
        const h = Math.max(160, Math.min(req.size.h, req.area.h - 8))
        const parent = req.parent ? d.windows.find((x) => x.id === req.parent) : undefined
        let x: number
        let y: number
        if (parent && !parent.maximized) {
          x = parent.x + 32
          y = parent.y + 32
        } else {
          // En cascade autour du centre du bureau
          const offset = (d.windows.filter((x) => !x.parent).length % 6) * 24 - 48
          x = (req.area.w - w) / 2 + offset
          y = (req.area.h - h) / 2 + offset
        }
        x = Math.round(Math.max(0, Math.min(x, req.area.w - w)))
        y = Math.round(Math.max(0, Math.min(y, req.area.h - h)))
        const win: DesktopWindow = {
          id,
          app: req.app,
          ...(req.arg !== undefined ? { arg: req.arg } : {}),
          ...(req.parent !== undefined ? { parent: req.parent } : {}),
          x,
          y,
          w,
          h,
          z,
          minimized: false,
          maximized: !!req.maximized
        }
        return { ...d, zTop: z, windows: [...d.windows, win] }
      })
      return id
    },

    close: (deviceId, winId) =>
      update(deviceId, (d) => {
        const gone = descendants(d.windows, winId)
        return { ...d, windows: d.windows.filter((w) => !gone.has(w.id)) }
      }),

    focus: (deviceId, winId) =>
      update(deviceId, (d) => {
        const target = d.windows.find((w) => w.id === winId)
        if (!target) return d
        // Une fenêtre bloquée par une boîte de dialogue donne le focus à celle-ci
        const child = d.windows.filter((w) => w.parent === winId).sort((a, b) => b.z - a.z)[0]
        const focusId = child ? child.id : winId
        const current = d.windows.find((w) => w.id === focusId)
        if (current && current.z === d.zTop && !current.minimized) return d
        const z = d.zTop + 1
        return {
          ...d,
          zTop: z,
          windows: d.windows.map((w) => (w.id === focusId ? { ...w, z, minimized: false } : w))
        }
      }),

    minimize: (deviceId, winId) =>
      update(deviceId, (d) => {
        const family = descendants(d.windows, winId)
        return { ...d, windows: d.windows.map((w) => (family.has(w.id) ? { ...w, minimized: true } : w)) }
      }),

    toggleMaximize: (deviceId, winId) =>
      update(deviceId, (d) => ({
        ...d,
        windows: d.windows.map((w) => (w.id === winId ? { ...w, maximized: !w.maximized } : w))
      })),

    setRect: (deviceId, winId, rect) =>
      update(deviceId, (d) => ({
        ...d,
        windows: d.windows.map((w) => (w.id === winId ? { ...w, ...rect } : w))
      })),

    minimizeAll: (deviceId) =>
      update(deviceId, (d) => ({ ...d, windows: d.windows.map((w) => ({ ...w, minimized: true })) })),

    syncBoot: (deviceId, bootedAt) => {
      const d = get().desktops[deviceId]
      if (d && d.boot === bootedAt) return
      update(deviceId, (cur) =>
        cur.boot === null
          ? { ...cur, boot: bootedAt }
          : { ...cur, boot: bootedAt, windows: [], notice: null, locked: true, autoStarted: false }
      )
    },

    setLocked: (deviceId, locked) => update(deviceId, (d) => ({ ...d, locked })),

    closeAll: (deviceId) =>
      update(deviceId, (d) => ({ ...d, windows: [], notice: null, locked: false, autoStarted: false })),

    markAutoStarted: (deviceId) => update(deviceId, (d) => ({ ...d, autoStarted: true })),

    showNotice: (deviceId, notice) => update(deviceId, (d) => ({ ...d, notice })),

    removeDevice: (deviceId) =>
      set((s) => {
        const next = { ...s.desktops }
        delete next[deviceId]
        return { desktops: next }
      }),

    reset: () => set({ desktops: {} })
  }
})
