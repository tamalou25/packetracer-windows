/**
 * Ouvre une nouvelle session dans les consoles d'un ordinateur lorsque l'utilisateur connecté
 * change (promotion, ouverture/fermeture de session, redémarrage).
 */
import { useEffect } from 'react'
import { useLabStore } from '../store/lab'
import { restartConsoles } from '../lib/console'

export function useConsoleSessionSync(): void {
  useEffect(() => {
    const key = (lab: ReturnType<typeof useLabStore.getState>['lab']) =>
      new Map(
        Object.values(lab.devices)
          .filter((d) => d.kind === 'server' || d.kind === 'client')
          .map((d) => [
            d.id,
            d.kind === 'server' || d.kind === 'client'
              ? `${d.host.session?.domain ?? ''}\\${d.host.session?.user ?? ''}`
              : ''
          ])
      )
    let previous = key(useLabStore.getState().lab)
    return useLabStore.subscribe((s) => {
      const next = key(s.lab)
      for (const [id, session] of next)
        if (previous.has(id) && previous.get(id) !== session) restartConsoles(id)
      previous = next
    })
  }, [])
}
