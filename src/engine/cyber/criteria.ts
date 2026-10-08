/**
 * Critères de lab de la cybersécurité : alertes de corrélation levées (ou non) par les journaux de
 * sécurité (volet défense, v2.6) ; état laissé par les scénarios et issue d'un scénario sur l'état
 * courant (volet attaque, v2.6.1). Aucune attaque n'est jouée par un critère : l'évaluation d'une
 * issue de scénario est une lecture, l'état du lab n'est jamais modifié.
 */
import { produce } from 'immer'
import { z } from 'zod'
import type { LabState } from '../model/schema'
import { defineCriterion, type CriterionType } from '../roles/types'
import { alertsFor } from './detection'
import { getScenario } from './registry'
import { playStep } from './scenario'

/**
 * État sans trace d'attaque : comptes et machines non compromis, aucun flux intercepté, aucun saut
 * de VLAN. Les critères « le scénario échoue » partent de là : un étudiant qui a rejoué les attaques
 * avant de durcir ne doit pas voir l'issue d'un scénario faussée par leurs effets.
 */
export function withoutAttackEffects(state: LabState): LabState {
  return produce(state, (draft) => {
    for (const domain of Object.values(draft.domains)) for (const u of domain.users) u.compromised = false
    draft.cyber.intercepts = []
    for (const d of Object.values(draft.devices)) {
      if (d.kind === 'server' || d.kind === 'client') d.host.controlled = false
      if (d.kind === 'switch') for (const p of d.interfaces) if (p.switchport) p.switchport.hoppedVlan = null
    }
  })
}

export const CYBER_CRITERIA: CriterionType[] = [
  defineCriterion(
    z.object({
      type: z.literal('detectionAlert'),
      rule: z.enum(['failuresThenSuccess', 'offHours']),
      /** Compte concerné (DOMAINE\\nom ou nom seul) ; absent : n'importe quel compte. */
      account: z.string().optional(),
      /** false : aucune alerte ne doit être levée. */
      present: z.boolean().default(true)
    }),
    (state, check) => alertsFor(state, check.rule, check.account).length > 0 === (check.present !== false),
    'Alerte de corrélation des journaux de sécurité'
  ),
  defineCriterion(
    z.object({
      type: z.literal('accountCompromised'),
      /** sAMAccountName ; absent : n'importe quel compte. */
      account: z.string().optional(),
      present: z.boolean().default(true)
    }),
    (state, check) => {
      const sam = check.account?.toLowerCase()
      const found = Object.values(state.domains).some((d) =>
        d.users.some((u) => u.compromised && (sam === undefined || u.sam.toLowerCase() === sam))
      )
      return found === (check.present !== false)
    },
    'Compte marqué compromis par un scénario'
  ),
  defineCriterion(
    z.object({
      type: z.literal('machineControlled'),
      /** Nom de l'ordinateur ; absent : n'importe lequel. */
      device: z.string().optional(),
      present: z.boolean().default(true)
    }),
    (state, check) => {
      const name = check.device?.toLowerCase()
      const found = Object.values(state.devices).some(
        (d) =>
          (d.kind === 'server' || d.kind === 'client') &&
          d.host.controlled &&
          (name === undefined || d.name.toLowerCase() === name)
      )
      return found === (check.present !== false)
    },
    'Accès administrateur obtenu sur un ordinateur par un scénario'
  ),
  defineCriterion(
    z.object({ type: z.literal('trafficIntercepted'), present: z.boolean().default(true) }),
    (state, check) => state.cyber.intercepts.length > 0 === (check.present !== false),
    'Trafic marqué comme intercepté sur le segment'
  ),
  defineCriterion(
    z.object({ type: z.literal('vlanHopped'), present: z.boolean().default(true) }),
    (state, check) =>
      Object.values(state.devices).some(
        (d) => d.kind === 'switch' && d.interfaces.some((p) => p.switchport?.hoppedVlan != null)
      ) ===
      (check.present !== false),
    'Hôte sorti de son VLAN par un scénario'
  ),
  defineCriterion(
    z.object({
      type: z.literal('scenarioOutcome'),
      scenario: z.string(),
      /** Scénarios joués à blanc, dans l'ordre, avant celui-ci (ex. une compromission préalable). */
      after: z.array(z.string()).default([]),
      /** true : le scénario réussirait sur l'état courant ; false : il échouerait (lab durci). */
      success: z.boolean().default(false)
    }),
    (state, check) => {
      const scenario = getScenario(check.scenario)
      if (!scenario) return false
      // Évaluation à blanc : les résultats de playStep sont jetés, l'état du lab reste intact
      let scratch = withoutAttackEffects(state)
      for (const id of check.after) {
        const earlier = getScenario(id)
        for (const [i] of (earlier?.steps ?? []).entries()) {
          const r = earlier ? playStep(scratch, earlier, i) : null
          if (r?.ok) scratch = r.state
        }
      }
      const outcomes = scenario.steps.map((_, i) => playStep(scratch, scenario, i))
      return outcomes.every((o) => o.ok && o.value.success) === check.success
    },
    'Issue d’un scénario sur l’état courant du lab'
  )
]
