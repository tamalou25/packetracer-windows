/**
 * Scénario « annuaire » 1 : authentification répétée sur un compte.
 *
 * Garde-fou : ce scénario ne modélise que l'EFFET d'une faiblesse de configuration sur l'état
 * simulé. Aucun mot de passe n'est deviné, aucun hash calculé, aucun ticket forgé. Une seule règle :
 * si le mot de passe du compte visé est faible au sens de la stratégie du domaine ET qu'aucun
 * verrouillage n'est configuré, le compte passe à l'état « compromis » ; si un seuil de
 * verrouillage existe (lu dans la stratégie du domaine), le compte se verrouille après ce nombre
 * d'échecs et la tentative échoue. Événements : 4771, 4768 et 4740 (formats de la v2.3).
 */
import { produce } from 'immer'
import { isLockedOut } from '../../roles/adds/lockout'
import { domainLockoutPolicy } from '../../roles/gpo/scope'
import type { AttackScenario, SecurityEvent, SimState } from '../scenario'
import { allAccounts, controllerOf, hasWeakPassword, pdcOf, qualified, type DomainAccount } from './common'

/** Compte visé, désigné par `state.cyber.targetAccount` (sAMAccountName). */
function target(state: SimState): DomainAccount | null {
  const sam = state.cyber.targetAccount?.toLowerCase()
  return (sam && allAccounts(state).find((a) => a.user.sam.toLowerCase() === sam)) || null
}

const threshold = (a: DomainAccount): number => domainLockoutPolicy(a.domain).threshold

function succeeds(state: SimState): boolean {
  const a = target(state)
  return (
    !!a &&
    a.user.enabled &&
    threshold(a) === 0 &&
    !isLockedOut(a.domain, a.user, state.clock) &&
    hasWeakPassword(a)
  )
}

/** Verrouille le compte visé si une stratégie de verrouillage est active. */
function lockTarget(state: SimState): SimState {
  const a = target(state)
  if (!a || !a.user.enabled || threshold(a) === 0 || isLockedOut(a.domain, a.user, state.clock)) return state
  return produce(state, (draft) => {
    const user = draft.domains[a.domain.name]?.users.find((u) => u.id === a.user.id)
    if (!user) return
    user.badPwdCount = threshold(a)
    user.lastBadPassword = draft.clock
    user.lockoutTime = draft.clock
  })
}

function failure(account: string, dc: string, n: number): SecurityEvent[] {
  return Array.from({ length: n }, () => ({
    deviceId: dc,
    level: 'warning' as const,
    source: 'Security-Auditing',
    eventId: 4771,
    account,
    message: `La pré-authentification Kerberos a échoué pour le compte ${account.split('\\')[1]} depuis le réseau interne.`
  }))
}

export const authRepetee: AttackScenario = {
  id: 'auth-repetee',
  name: 'Authentification répétée sur un compte',
  category: 'annuaire',
  steps: [
    {
      id: 'tentatives',
      label: 'Tentatives d’authentification répétées',
      precondition: succeeds,
      onSuccess: (state) =>
        produce(state, (draft) => {
          const a = target(state)
          const user = a && draft.domains[a.domain.name]?.users.find((u) => u.id === a.user.id)
          if (user) {
            user.compromised = true
            user.badPwdCount = 0
            user.lastBadPassword = null
          }
        }),
      onFailure: lockTarget,
      emits: (success, state) => {
        const a = target(state)
        const dc = a && controllerOf(a.domain)
        if (!a || !dc) return []
        const account = qualified(a)
        if (success)
          return [
            ...failure(account, dc, state.cyber.attempts - 1),
            {
              deviceId: dc,
              level: 'information',
              source: 'Security-Auditing',
              eventId: 4768,
              account,
              message: `Un ticket d’authentification Kerberos (TGT) a été demandé pour ${account} depuis le réseau interne.`
            }
          ]
        if (isLockedOut(a.domain, a.user, state.clock))
          return [
            {
              deviceId: dc,
              level: 'warning',
              source: 'Security-Auditing',
              eventId: 4768,
              account,
              message: `Un ticket d’authentification Kerberos (TGT) a été demandé pour ${account} depuis le réseau interne. Code d’échec : 0x12.`
            }
          ]
        const limit = threshold(a)
        if (limit === 0) return failure(account, dc, state.cyber.attempts)
        const pdc = pdcOf(a.domain) ?? dc
        return [
          ...failure(account, dc, limit),
          {
            deviceId: pdc,
            level: 'information',
            source: 'Security-Auditing',
            eventId: 4740,
            account,
            message: `Un compte d’utilisateur a été verrouillé. Compte : ${account}. Ordinateur appelant : réseau interne.`
          }
        ]
      }
    }
  ]
}
