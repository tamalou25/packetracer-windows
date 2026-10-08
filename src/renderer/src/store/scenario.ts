/**
 * Scénario en cours dans le panneau Simulation : choix, curseur d'étape et chronologie des étapes
 * jouées. L'effet sur le lab passe par la commande `cyber.playStep` ; ce store ne garde que l'affichage.
 */
import { create } from 'zustand'
import { command, getScenario, type StepRecord } from '@engine/index'
import { runNetworkOperation } from '../lib/network'
import { useLabStore } from './lab'

interface ScenarioState {
  scenarioId: string | null
  /** Indice de la prochaine étape à jouer. */
  cursor: number
  timeline: StepRecord[]
  /** Message d'erreur de la dernière étape refusée. */
  error: string | null

  select: (scenarioId: string | null) => void
  /** Joue l'étape suivante (un tour). */
  step: () => void
  reset: () => void
}

export const useScenarioStore = create<ScenarioState>()((set, get) => ({
  scenarioId: null,
  cursor: 0,
  timeline: [],
  error: null,

  select: (scenarioId) => set({ scenarioId, cursor: 0, timeline: [], error: null }),

  step: () => {
    const { scenarioId, cursor } = get()
    const scenario = scenarioId ? getScenario(scenarioId) : undefined
    if (!scenarioId || !scenario || cursor >= scenario.steps.length) return
    const result = useLabStore.getState().dispatch(command('cyber.playStep', scenarioId, cursor))
    // Étape à échange de paquets : rejouée pas à pas en mode Simulation (sans effet en Temps réel)
    if (result.ok && result.value.trace) runNetworkOperation(result.value.trace, () => undefined)
    if (result.ok)
      set((s) => ({ cursor: s.cursor + 1, timeline: [...s.timeline, result.value], error: null }))
    else set({ error: result.error.message })
  },

  reset: () => set({ cursor: 0, timeline: [], error: null })
}))
