/**
 * Critères de lab NPS : client RADIUS déclaré, stratégie réseau d'un groupe, décision d'accès.
 */
import { z } from 'zod'
import { serverByName } from '../../labs/lookup'
import { domainOf } from '../files/acl'
import { findGroupByName } from '../adds/directory'
import { defineCriterion } from '../types'
import { npsAccessFor } from './radius'
import { npsOf } from './state'

export const npsCriteria = [
  defineCriterion(
    z.object({ type: z.literal('radiusClient'), server: z.string(), address: z.string() }),
    (state, check) =>
      !!npsOf(serverByName(state, check.server))?.radiusClients.some((c) => c.address === check.address),
    'Client RADIUS'
  ),
  defineCriterion(
    z.object({
      type: z.literal('npsPolicy'),
      server: z.string(),
      group: z.string(),
      access: z.enum(['Grant', 'Deny'])
    }),
    (state, check) => {
      const server = serverByName(state, check.server)
      const domain = server ? domainOf(state, server) : undefined
      const name = check.group.includes('\\') ? (check.group.split('\\')[1] ?? '') : check.group
      const group = domain ? findGroupByName(domain, name) : undefined
      return (
        !!group &&
        !!npsOf(server)?.policies.some(
          (p) => p.enabled && p.access === check.access && p.groups.includes(group.id)
        )
      )
    },
    'Stratégie réseau NPS'
  ),
  defineCriterion(
    z.object({ type: z.literal('npsAccess'), server: z.string(), user: z.string(), granted: z.boolean() }),
    (state, check) => {
      const server = serverByName(state, check.server)
      if (!server || !npsOf(server)) return false
      return npsAccessFor(state, server, check.user)?.granted === check.granted
    },
    'Accès accordé ou refusé par NPS'
  )
]
