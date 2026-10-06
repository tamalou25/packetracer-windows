/**
 * Critères de lab du rôle AD DS.
 */
import { z } from 'zod'
import { firstDomain, fqdn, hostByName, sameName } from '../../labs/lookup'
import { defineCriterion } from '../types'
import { allObjects, findContainer, groupsOf } from './directory'

export const addsCriteria = [
  defineCriterion(
    z.object({
      type: z.literal('adObject'),
      kind: z.enum(['ou', 'user', 'group', 'computer']),
      name: z.string(),
      /** Nom de l'unité d'organisation parente. */
      parent: z.string().optional(),
      /** Groupe dont l'objet doit être membre (directement ou par imbrication). */
      memberOf: z.string().optional(),
      enabled: z.boolean().optional()
    }),
    (state, check) => {
      const domain = firstDomain(state)
      if (!domain) return false
      const found = allObjects(domain).find((o) => {
        if (o.kind !== (check.kind === 'ou' ? 'container' : check.kind)) return false
        if (o.kind === 'container' && o.obj.kind !== 'ou') return false
        return (
          sameName(o.obj.name, check.name) ||
          (o.kind !== 'container' && o.kind !== 'computer' && sameName(o.obj.sam, check.name))
        )
      })
      if (!found) return false
      if (check.parent !== undefined) {
        const parent = findContainer(domain, found.obj.parentId)
        if (!parent || !sameName(parent.name, check.parent)) return false
      }
      if (
        check.memberOf !== undefined &&
        !groupsOf(domain, found.obj.id).some((g) => sameName(g.name, check.memberOf ?? ''))
      )
        return false
      if (check.enabled !== undefined && (found.kind === 'user' || found.kind === 'computer'))
        return found.obj.enabled === check.enabled
      return true
    }
  ),
  defineCriterion(
    z.object({ type: z.literal('domainJoined'), device: z.string(), domain: z.string() }),
    (state, check) => hostByName(state, check.device)?.host.domain === fqdn(check.domain)
  )
]
