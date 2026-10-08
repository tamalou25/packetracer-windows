/**
 * Scénario « annuaire » 2 : compte de service mal configuré.
 *
 * Garde-fou : aucun ticket Kerberos n'est demandé ni déchiffré pour de vrai, aucun mot de passe
 * n'est cassé. Règle unique : si un compte de service (au moins un SPN) a un mot de passe inchangé
 * depuis plus longtemps que `state.cyber.serviceMaxAgeDays`, il passe à l'état « compromis » ;
 * sinon rien n'est modifié. Événement : 4769 (format de la v2.3).
 */
import { produce } from 'immer'
import type { AttackScenario, SimState } from '../scenario'
import { allAccounts, controllerOf, DAY_MS, qualified, type DomainAccount } from './common'

const serviceAccounts = (state: SimState): DomainAccount[] =>
  allAccounts(state).filter((a) => a.user.enabled && a.user.spns.length > 0)

/** Mot de passe inchangé depuis la durée configurée dans le lab. */
const neglected = (state: SimState, a: DomainAccount): boolean =>
  state.clock - a.user.passwordLastSet >= state.cyber.serviceMaxAgeDays * DAY_MS

const vulnerable = (state: SimState): DomainAccount | undefined =>
  serviceAccounts(state).find((a) => neglected(state, a))

export const compteService: AttackScenario = {
  id: 'compte-service',
  name: 'Compte de service mal configuré',
  category: 'annuaire',
  steps: [
    {
      id: 'ticket-service',
      label: 'Demande de ticket de service',
      precondition: (state) => !!vulnerable(state),
      onSuccess: (state) =>
        produce(state, (draft) => {
          const a = vulnerable(state)
          const user = a && draft.domains[a.domain.name]?.users.find((u) => u.id === a.user.id)
          if (user) user.compromised = true
        }),
      onFailure: (state) => state,
      // La demande de ticket est journalisée même quand elle ne mène à rien
      emits: (success, state) => {
        const a = (success ? vulnerable(state) : undefined) ?? serviceAccounts(state)[0]
        const dc = a && controllerOf(a.domain)
        if (!a || !dc) return []
        return [
          {
            deviceId: dc,
            level: 'information',
            source: 'Security-Auditing',
            eventId: 4769,
            account: qualified(a),
            message: `Un ticket de service Kerberos a été demandé. Nom du service : ${a.user.sam}. SPN : ${a.user.spns[0]}.`
          }
        ]
      }
    }
  ]
}
