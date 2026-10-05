/**
 * Critères de lab du rôle DHCP.
 */
import { z } from 'zod'
import { byName, hostByName, serverByName } from '../../labs/lookup'
import { defineCriterion } from '../types'

export const dhcpCriteria = [
  defineCriterion(
    z.object({
      type: z.literal('dhcpScope'),
      server: z.string(),
      start: z.string(),
      end: z.string(),
      prefixLength: z.number().int().optional(),
      router: z.string().optional(),
      dnsServer: z.string().optional()
    }),
    (state, check) => {
      const scopes = serverByName(state, check.server)?.services.dhcp?.scopes ?? []
      return scopes.some(
        (s) =>
          s.start === check.start &&
          s.end === check.end &&
          s.state === 'Active' &&
          (check.prefixLength === undefined || s.prefixLength === check.prefixLength) &&
          (check.router === undefined || s.options.router.includes(check.router)) &&
          (check.dnsServer === undefined || s.options.dnsServers.includes(check.dnsServer))
      )
    }
  ),
  defineCriterion(
    z.object({ type: z.literal('dhcpLease'), client: z.string(), server: z.string().optional() }),
    (state, check) => {
      const client = hostByName(state, check.client)
      const server = check.server ? byName(state, check.server) : undefined
      return !!client?.interfaces.some(
        (i) =>
          i.addressing === 'dhcp' && !!i.dhcpLease && (!server || i.dhcpLease.serverDeviceId === server.id)
      )
    }
  )
]
