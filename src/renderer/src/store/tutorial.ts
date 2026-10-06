/**
 * Tutoriel « premier ping » : phase affichée et réponses d'écho observées depuis son début
 * (la progression elle-même est calculée par le moteur sur l'état du lab).
 */
import { create } from 'zustand'
import type { EchoReceived } from '@engine/index'

export type TutorialPhase = 'off' | 'welcome' | 'running' | 'done'

interface TutorialStore {
  phase: TutorialPhase
  echoes: EchoReceived[]
  /** Révision du document créé pour le tutoriel : un autre document chargé y met fin. */
  revision: number | null
  offer: () => void
  begin: (revision: number) => void
  addEchoes: (echoes: EchoReceived[]) => void
  finish: () => void
  close: () => void
}

export const useTutorialStore = create<TutorialStore>()((set) => ({
  phase: 'off',
  echoes: [],
  revision: null,
  offer: () => set({ phase: 'welcome', echoes: [], revision: null }),
  begin: (revision) => set({ phase: 'running', echoes: [], revision }),
  // Les derniers échos suffisent (la paire suivie peut changer d'adresse entre-temps)
  addEchoes: (echoes) => set((s) => ({ echoes: [...s.echoes, ...echoes].slice(-50) })),
  finish: () => set({ phase: 'done' }),
  close: () => set({ phase: 'off', echoes: [], revision: null })
}))
