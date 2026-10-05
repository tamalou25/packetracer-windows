/**
 * Applications ouvertes sur le Bureau de chaque ordinateur.
 */
import { create } from 'zustand'

interface DesktopState {
  open: Record<string, string[]>
  active: Record<string, string | null>
  launch: (deviceId: string, appId: string) => void
  close: (deviceId: string, appId: string) => void
  focus: (deviceId: string, appId: string | null) => void
  reset: () => void
}

export const useDesktopStore = create<DesktopState>()((set) => ({
  open: {},
  active: {},
  launch: (deviceId, appId) =>
    set((s) => {
      const open = s.open[deviceId] ?? []
      return {
        open: { ...s.open, [deviceId]: open.includes(appId) ? open : [...open, appId] },
        active: { ...s.active, [deviceId]: appId }
      }
    }),
  close: (deviceId, appId) =>
    set((s) => {
      const open = (s.open[deviceId] ?? []).filter((a) => a !== appId)
      const active =
        s.active[deviceId] === appId ? (open[open.length - 1] ?? null) : (s.active[deviceId] ?? null)
      return { open: { ...s.open, [deviceId]: open }, active: { ...s.active, [deviceId]: active } }
    }),
  focus: (deviceId, appId) => set((s) => ({ active: { ...s.active, [deviceId]: appId } })),
  reset: () => set({ open: {}, active: {} })
}))
