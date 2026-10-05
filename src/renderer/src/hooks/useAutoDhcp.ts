/**
 * Client DHCP en tâche de fond (mode Temps réel) : après chaque modification du lab,
 * les cartes en DHCP sans bail tentent d'en obtenir un, comme sur un vrai poste.
 */
import { useEffect } from 'react'
import { autoConfigureDhcp } from '@engine/index'
import { useLabStore } from '../store/lab'
import { useUiStore } from '../store/ui'

export function useAutoDhcp(): void {
  const mode = useUiStore((s) => s.mode)
  useEffect(() => {
    if (mode !== 'realtime') return
    let scheduled = false
    const refresh = () => {
      if (scheduled) return
      scheduled = true
      // Après la mise à jour en cours (évite les modifications imbriquées)
      queueMicrotask(() => {
        scheduled = false
        const lab = useLabStore.getState().lab
        const result = autoConfigureDhcp(lab)
        if (result.state !== lab && useLabStore.getState().lab === lab) {
          useLabStore
            .getState()
            .run(() => ({ ok: true, state: result.state, value: undefined }), { undoable: false })
        }
      })
    }
    refresh()
    return useLabStore.subscribe((s, prev) => {
      if (s.lab !== prev.lab) refresh()
    })
  }, [mode])
}
