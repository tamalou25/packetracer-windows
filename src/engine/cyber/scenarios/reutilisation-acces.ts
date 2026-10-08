/**
 * Scénario « annuaire » 3 : réutilisation d'un accès déjà obtenu.
 *
 * Garde-fou : aucun identifiant n'est extrait ni rejoué pour de vrai. Règle unique : si un compte
 * marqué « compromis » (par un scénario précédent) a une session ouverte sur une machine allumée, et
 * que cette machine a un accès administrateur vers une autre machine du lab, alors la machine cible
 * passe à l'état « contrôlée ». Sinon rien n'est modifié. Événements : 4624 (type 3) et 4672.
 */
import { produce } from 'immer'
import type { AttackScenario, SimState } from '../scenario'
import { allAccounts, hostOf, qualified, type DomainAccount } from './common'

interface Propagation {
  account: DomainAccount
  sourceId: string
  targetId: string
}

/** Première propagation possible : compte compromis en session sur une machine qui administre une autre. */
function find(state: SimState): Propagation | null {
  for (const account of allAccounts(state).filter((a) => a.user.compromised)) {
    for (const [sourceId] of Object.entries(state.devices)) {
      const source = hostOf(state, sourceId)
      const session = source?.host.session
      if (!source?.powered || !session || session.user.toLowerCase() !== account.user.sam.toLowerCase())
        continue
      if (session.domain?.toUpperCase() !== account.domain.netbios.toUpperCase()) continue
      const targetId = source.host.adminTargets.find((id) => {
        const t = hostOf(state, id)
        return !!t && t.powered && !t.host.controlled
      })
      if (targetId) return { account, sourceId, targetId }
    }
  }
  return null
}

export const reutilisationAcces: AttackScenario = {
  id: 'reutilisation-acces',
  name: 'Réutilisation d’un accès déjà obtenu',
  category: 'annuaire',
  steps: [
    {
      id: 'propagation',
      label: 'Propagation de l’accès administrateur',
      precondition: (state) => find(state) !== null,
      onSuccess: (state) =>
        produce(state, (draft) => {
          const found = find(state)
          const target = found && draft.devices[found.targetId]
          if (target && (target.kind === 'server' || target.kind === 'client')) target.host.controlled = true
        }),
      onFailure: (state) => state,
      emits: (success, state) => {
        const found = success ? find(state) : null
        if (!found) return []
        const account = qualified(found.account)
        const from = state.devices[found.sourceId]?.name ?? '?'
        return [
          {
            deviceId: found.targetId,
            level: 'information',
            source: 'Security-Auditing',
            eventId: 4624,
            account,
            message: `Ouverture de session réussie : ${account}. Type d’ouverture de session : 3 (Network). Ordinateur source : ${from}.`
          },
          {
            deviceId: found.targetId,
            level: 'information',
            source: 'Security-Auditing',
            eventId: 4672,
            account,
            message: `Privilèges spéciaux attribués à la nouvelle ouverture de session. Compte : ${account}.`
          }
        ]
      }
    }
  ]
}
