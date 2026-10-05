/**
 * Services en tâche de fond (mode Temps réel), après chaque modification du lab, comme sur de
 * vrais ordinateurs : le client DHCP demande un bail pour les cartes qui n'en ont pas, puis les
 * membres du domaine appliquent leurs stratégies de groupe après un démarrage.
 */
import { useEffect } from 'react'
import { autoConfigureDhcp, autoGroupPolicy } from '@engine/index'
import { useLabStore } from '../store/lab'
import { useUiStore } from '../store/ui'

export function useBackgroundServices(): void {
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
        const dhcp = autoConfigureDhcp(lab)
        const policy = autoGroupPolicy(dhcp.state)
        if (policy.state !== lab && useLabStore.getState().lab === lab) {
          useLabStore
            .getState()
            .run(() => ({ ok: true, state: policy.state, value: undefined }), { undoable: false })
        }
      })
    }
    refresh()
    return useLabStore.subscribe((s, prev) => {
      if (s.lab !== prev.lab) refresh()
    })
  }, [mode])
}
