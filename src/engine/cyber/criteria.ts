/**
 * Critères de lab de la cybersécurité défensive : alertes de corrélation levées (ou non) par les
 * journaux de sécurité du lab.
 */
import { z } from 'zod'
import { defineCriterion, type CriterionType } from '../roles/types'
import { alertsFor } from './detection'

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
  )
]
