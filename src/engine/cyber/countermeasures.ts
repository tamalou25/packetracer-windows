/**
 * Contre-mesures du mode Red/Blue. Chacune applique des actions de durcissement DÉJÀ existantes
 * (stratégie de verrouillage du domaine, réinitialisation de mot de passe, commandes IOS) : aucune
 * logique nouvelle, aucune faiblesse cachée. Le catalogue sert au joueur Blue comme à l'IA Blue.
 */
import { fail, type EngineResult } from '../core/result'
import { runIosScript } from '../ios/cli'
import { iosState } from '../ios/config'
import { isIos } from '../ios/device'
import type { Device, Domain, LabState } from '../model/schema'
import { switchportOf } from '../net/switchport'
import { resetPassword } from '../roles/adds/objects'
import { DEFAULT_DOMAIN_POLICY_ID } from '../roles/gpo/defaults'
import { updateGpoSettings } from '../roles/gpo/objects'
import { domainLockoutPolicy } from '../roles/gpo/scope'
import { allAccounts, DAY_MS, hasWeakPassword } from './scenarios/common'
import { deviceByName, hostPortOf } from './scenarios/reseau'

export type CountermeasureDomain = 'annuaire' | 'reseau'

export interface Countermeasure {
  id: string
  domain: CountermeasureDomain
  /** Libellé en français (affiché au joueur). */
  label: string
  /** Aide : commande ou réglage équivalent. */
  hint: string
  /** Utile dans ce lab (cible présente) et pas déjà en place. */
  applicable(state: LabState): boolean
  apply(state: LabState): EngineResult
}

/** Compte visé par l'authentification répétée. */
function targetAccount(state: LabState) {
  const sam = state.cyber.targetAccount?.toLowerCase()
  return (sam && allAccounts(state).find((a) => a.user.sam.toLowerCase() === sam)) || null
}

/** Mot de passe fort déterministe (dérivé de `state.seq`, jamais aléatoire). */
const strongPassword = (state: LabState): string => `Sl#${state.seq}-Xv9k!Ra2`

const serviceAccounts = (state: LabState) => allAccounts(state).filter((a) => a.user.spns.length > 0)
const neglectedServices = (state: LabState) =>
  serviceAccounts(state).filter(
    (a) => state.clock - a.user.passwordLastSet >= state.cyber.serviceMaxAgeDays * DAY_MS
  )

/** Switch IOS, port et VLAN de l'hôte agresseur désigné par le lab. */
function attackerPort(state: LabState): { sw: Device; port: string; vlan: number } | null {
  const name = state.cyber.arpSpoof?.attacker ?? state.cyber.vlanHop?.attacker
  const host = name ? deviceByName(state, name) : undefined
  const located = host && hostPortOf(state, host)
  if (!located || !isIos(located.sw)) return null
  const config = switchportOf(located.port)
  return { sw: located.sw, port: located.port.name, vlan: config.accessVlan }
}

/** Saisit des lignes dans la console IOS du switch (une erreur de syntaxe devient une erreur métier). */
function iosLines(state: LabState, switchId: string, lines: string[]): EngineResult {
  try {
    return {
      ok: true,
      state: runIosScript(state, switchId, ['enable', 'configure terminal', ...lines, 'end']),
      value: undefined
    }
  } catch (e) {
    return fail('IosError', e instanceof Error ? e.message : 'Commande IOS refusée.')
  }
}

function resetAll(state: LabState, domain: Domain[], sams: string[]): EngineResult {
  let current = state
  for (const [i, sam] of sams.entries()) {
    const r = resetPassword(current, domain[i]!.name, sam, strongPassword(current), false)
    if (!r.ok) return r
    current = r.state
  }
  return { ok: true, state: current, value: undefined }
}

export const COUNTERMEASURES: Countermeasure[] = [
  {
    id: 'lockout',
    domain: 'annuaire',
    label: 'Activer le verrouillage de compte (3 échecs)',
    hint: 'Stratégie de domaine : seuil de verrouillage 3, durée 30 min.',
    applicable: (state) => {
      const a = targetAccount(state)
      return !!a && domainLockoutPolicy(a.domain).threshold === 0
    },
    apply: (state) => {
      const a = targetAccount(state)
      if (!a) return fail('NotApplicable', 'Aucun compte visé dans ce lab.')
      return updateGpoSettings(state, a.domain.name, DEFAULT_DOMAIN_POLICY_ID, {
        computer: { lockoutThreshold: 3, lockoutDuration: 30, lockoutReset: 30 }
      })
    }
  },
  {
    id: 'strong-password',
    domain: 'annuaire',
    label: 'Imposer un mot de passe conforme au compte visé',
    hint: 'Set-ADAccountPassword : mot de passe respectant la stratégie du domaine.',
    applicable: (state) => {
      const a = targetAccount(state)
      return !!a && hasWeakPassword(a)
    },
    apply: (state) => {
      const a = targetAccount(state)
      if (!a) return fail('NotApplicable', 'Aucun compte visé dans ce lab.')
      return resetAll(state, [a.domain], [a.user.sam])
    }
  },
  {
    id: 'rotate-service',
    domain: 'annuaire',
    label: 'Renouveler le mot de passe des comptes de service',
    hint: 'Set-ADAccountPassword sur chaque compte portant un SPN.',
    applicable: (state) => neglectedServices(state).length > 0,
    apply: (state) => {
      const accounts = neglectedServices(state)
      if (accounts.length === 0) return fail('NotApplicable', 'Aucun compte de service négligé.')
      return resetAll(
        state,
        accounts.map((a) => a.domain),
        accounts.map((a) => a.user.sam)
      )
    }
  },
  {
    id: 'dai',
    domain: 'reseau',
    label: 'Activer l’inspection ARP dynamique sur le VLAN de l’hôte',
    hint: 'ip dhcp snooping · ip dhcp snooping vlan N · ip arp inspection vlan N',
    applicable: (state) => {
      const t = attackerPort(state)
      return !!t && isIos(t.sw) && !iosState(t.sw).arpInspectionVlans.includes(t.vlan)
    },
    apply: (state) => {
      const t = attackerPort(state)
      if (!t) return fail('NotApplicable', 'Aucun switch Cisco à durcir dans ce lab.')
      return iosLines(state, t.sw.id, [
        'ip dhcp snooping',
        `ip dhcp snooping vlan ${t.vlan}`,
        `ip arp inspection vlan ${t.vlan}`
      ])
    }
  },
  {
    id: 'nonegotiate',
    domain: 'reseau',
    label: 'Désactiver la négociation de trunk sur le port de l’hôte',
    hint: 'interface <port> · switchport nonegotiate',
    applicable: (state) => {
      const t = attackerPort(state)
      return !!t && isIos(t.sw) && !iosState(t.sw).interfaces[t.port]?.nonegotiate
    },
    apply: (state) => {
      const t = attackerPort(state)
      if (!t) return fail('NotApplicable', 'Aucun switch Cisco à durcir dans ce lab.')
      return iosLines(state, t.sw.id, [`interface ${t.port}`, 'switchport nonegotiate'])
    }
  }
]

export const getCountermeasure = (id: string): Countermeasure | undefined =>
  COUNTERMEASURES.find((c) => c.id === id)

/** Contre-mesures utiles dans ce lab (cible présente, pas déjà en place). */
export const availableCountermeasures = (state: LabState): Countermeasure[] =>
  COUNTERMEASURES.filter((c) => c.applicable(state))

/** Applique une contre-mesure (commande nommée `cyber.applyCountermeasure`). */
export function applyCountermeasure(state: LabState, id: string): EngineResult {
  const cm = getCountermeasure(id)
  if (!cm) return fail('CountermeasureNotFound', `Contre-mesure inconnue : ${id}.`)
  if (!cm.applicable(state))
    return fail('NotApplicable', 'Cette contre-mesure est déjà en place ou ne concerne pas ce lab.')
  return cm.apply(state)
}
