/**
 * Lecture automatique du mode Simulation et passage en Temps réel.
 */
import { useEffect } from 'react'
import { useSimStore } from '../store/sim'
import { useUiStore } from '../store/ui'

const PLAY_INTERVAL_MS = 900

export function useSimulationPlayback(): void {
  const playing = useSimStore((s) => s.playing)
  const mode = useUiStore((s) => s.mode)

  // Lecture automatique : un pas toutes les 900 ms
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => useSimStore.getState().step(), PLAY_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [playing])

  // En repassant en Temps réel, les opérations en attente se terminent immédiatement
  useEffect(() => {
    if (mode === 'realtime') useSimStore.getState().flush()
  }, [mode])
}
