/**
 * État d'interface (non simulé) : mode, outils, sélection, fenêtres, notifications…
 * L'état simulé, lui, vit dans le moteur (voir store/lab.ts).
 */
import { create } from 'zustand'
import type { Device, DeviceKind, Link } from '@engine/index'
import type { SimMode } from '@shared/ipc'

/** Outil actif sur le canvas. */
export type Tool = 'select' | 'cable' | 'delete'

export type DeviceTab = 'config' | 'desktop' | 'console'

export interface DeviceWindowState {
  deviceId: string
  x: number
  y: number
  z: number
  tab: DeviceTab
}

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  message: string
}

/** Boîte de dialogue modale applicative. */
export interface ModalState {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm?: () => void
  onCancel?: () => void
}

export interface Selection {
  devices: string[]
  link: string | null
}

/** Premier port choisi lors du câblage. */
export interface CableStart {
  deviceId: string
  ifaceId: string
}

interface UiState {
  mode: SimMode
  showPortLabels: boolean
  showProperties: boolean
  tool: Tool
  /** Équipement de la palette « armé » (clic puis clic sur le canvas). */
  armed: DeviceKind | null
  selection: Selection
  cableStart: CableStart | null
  windows: DeviceWindowState[]
  toasts: Toast[]
  modal: ModalState | null
  helpPanel: 'guide' | 'shortcuts' | null
  clipboard: { devices: Device[]; links: Link[] } | null
  pasteCount: number
  appVersion: string

  setMode: (mode: SimMode) => void
  togglePortLabels: () => void
  toggleProperties: () => void
  setTool: (tool: Tool) => void
  setArmed: (kind: DeviceKind | null) => void
  select: (selection: Partial<Selection>) => void
  clearSelection: () => void
  setCableStart: (start: CableStart | null) => void
  openWindow: (deviceId: string, tab?: DeviceTab) => void
  closeWindow: (deviceId: string) => void
  focusWindow: (deviceId: string) => void
  moveWindow: (deviceId: string, x: number, y: number) => void
  setWindowTab: (deviceId: string, tab: DeviceTab) => void
  notify: (kind: Toast['kind'], message: string) => void
  dismissToast: (id: number) => void
  showModal: (modal: ModalState | null) => void
  setHelpPanel: (panel: UiState['helpPanel']) => void
  setClipboard: (clip: UiState['clipboard']) => void
  nextPasteOffset: () => number
  setAppVersion: (version: string) => void
}

let toastSeq = 0

export const useUiStore = create<UiState>()((set, get) => ({
  mode: 'realtime',
  showPortLabels: false,
  showProperties: true,
  tool: 'select',
  armed: null,
  selection: { devices: [], link: null },
  cableStart: null,
  windows: [],
  toasts: [],
  modal: null,
  helpPanel: null,
  clipboard: null,
  pasteCount: 0,
  appVersion: '0.0.0',

  setMode: (mode) => set({ mode }),
  togglePortLabels: () => set((s) => ({ showPortLabels: !s.showPortLabels })),
  toggleProperties: () => set((s) => ({ showProperties: !s.showProperties })),
  setTool: (tool) => set({ tool, cableStart: null, armed: null }),
  setArmed: (armed) => set({ armed, tool: 'select', cableStart: null }),
  select: (selection) => set((s) => ({ selection: { ...s.selection, ...selection } })),
  clearSelection: () => set({ selection: { devices: [], link: null } }),
  setCableStart: (cableStart) => set({ cableStart }),

  openWindow: (deviceId, tab) =>
    set((s) => {
      const z = Math.max(0, ...s.windows.map((w) => w.z)) + 1
      const existing = s.windows.find((w) => w.deviceId === deviceId)
      if (existing) {
        return {
          windows: s.windows.map((w) => (w.deviceId === deviceId ? { ...w, z, tab: tab ?? w.tab } : w))
        }
      }
      const offset = (s.windows.length % 6) * 28
      return {
        windows: [...s.windows, { deviceId, x: 120 + offset, y: 60 + offset, z, tab: tab ?? 'config' }]
      }
    }),
  closeWindow: (deviceId) => set((s) => ({ windows: s.windows.filter((w) => w.deviceId !== deviceId) })),
  focusWindow: (deviceId) =>
    set((s) => {
      const top = Math.max(0, ...s.windows.map((w) => w.z))
      const current = s.windows.find((w) => w.deviceId === deviceId)
      if (!current || current.z === top) return {}
      return { windows: s.windows.map((w) => (w.deviceId === deviceId ? { ...w, z: top + 1 } : w)) }
    }),
  moveWindow: (deviceId, x, y) =>
    set((s) => ({ windows: s.windows.map((w) => (w.deviceId === deviceId ? { ...w, x, y } : w)) })),
  setWindowTab: (deviceId, tab) =>
    set((s) => ({ windows: s.windows.map((w) => (w.deviceId === deviceId ? { ...w, tab } : w)) })),

  notify: (kind, message) => {
    const id = ++toastSeq
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, kind, message }] }))
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 3500)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  showModal: (modal) => set({ modal }),
  setHelpPanel: (helpPanel) => set({ helpPanel }),
  setClipboard: (clipboard) => set({ clipboard, pasteCount: 0 }),
  nextPasteOffset: () => {
    const count = get().pasteCount + 1
    set({ pasteCount: count })
    return count * 40
  },
  setAppVersion: (appVersion) => set({ appVersion })
}))
