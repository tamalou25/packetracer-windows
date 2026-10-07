/**
 * Critères de lab de la sauvegarde et de la Corbeille Active Directory.
 */
import { z } from 'zod'
import { serverByName } from '../../labs/lookup'
import { defineCriterion } from '../types'
import { backupOf } from './state'

const covers = (items: string[], item: string) =>
  items.some(
    (i) => item.toLowerCase() === i.toLowerCase() || item.toLowerCase().startsWith(`${i.toLowerCase()}\\`)
  )

export const backupCriteria = [
  defineCriterion(
    z.object({
      type: z.literal('backupPolicy'),
      server: z.string(),
      item: z.string().optional(),
      systemState: z.boolean().optional()
    }),
    (state, check) => {
      const policy = backupOf(serverByName(state, check.server))?.policy
      if (!policy) return false
      return (
        (check.item === undefined || covers(policy.items, check.item)) &&
        (check.systemState === undefined || policy.systemState === check.systemState)
      )
    },
    'Sauvegarde planifiée'
  ),
  defineCriterion(
    z.object({
      type: z.literal('backupSet'),
      server: z.string(),
      /** Élément (chemin local) contenu dans au moins une sauvegarde. */
      item: z.string().optional(),
      systemState: z.boolean().optional()
    }),
    (state, check) =>
      (backupOf(serverByName(state, check.server))?.sets ?? []).some(
        (s) =>
          (check.item === undefined ||
            s.entries.some((e) => e.path.toLowerCase() === check.item?.toLowerCase())) &&
          (check.systemState === undefined || s.systemState === check.systemState)
      ),
    'Sauvegarde réalisée'
  ),
  defineCriterion(
    z.object({ type: z.literal('adRecycleBin'), domain: z.string() }),
    (state, check) => !!state.domains[check.domain.toLowerCase()]?.recycleBin,
    'Corbeille Active Directory activée'
  )
]
