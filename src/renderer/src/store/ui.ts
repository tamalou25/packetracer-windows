/**
 * État d'interface (non simulé) : mode, panneaux affichés…
 * L'état simulé, lui, vit dans le moteur (voir store/lab.ts).
 */
import { create } from 'zustand'
import type { SimMode } from '@shared/ipc'

interface UiState {
  mode: SimMode
  showPortLabels: boolean
  showProperties: boolean
  setMode: (mode: SimMode) => void
  togglePortLabels: () => void
  toggleProperties: () => void
}

export const useUiStore = create<UiState>()((set) => ({
  mode: 'realtime',
  showPortLabels: false,
  showProperties: true,
  setMode: (mode) => set({ mode }),
  togglePortLabels: () => set((s) => ({ showPortLabels: !s.showPortLabels })),
  toggleProperties: () => set((s) => ({ showProperties: !s.showProperties }))
}))
