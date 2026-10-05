/**
 * Critères de lab du rôle DNS.
 */
import { z } from 'zod'
import { byName, fqdn, sameName, serverByName } from '../../labs/lookup'
import { defineCriterion } from '../types'
import { firstAddress, resolveName } from './resolver'

export const dnsCriteria = [
  defineCriterion(
    z.object({
      type: z.literal('dnsRecord'),
      server: z.string(),
      zone: z.string(),
      name: z.string(),
      recordType: z.enum(['A', 'PTR', 'CNAME', 'NS', 'SRV']),
      data: z.string().optional()
    }),
    (state, check) => {
      const zone = serverByName(state, check.server)?.services.dns?.zones.find(
        (z) => z.name === fqdn(check.zone)
      )
      return !!zone?.records.some(
        (r) =>
          r.type === check.recordType &&
          sameName(r.name, check.name) &&
          (check.data === undefined || fqdn(r.data) === fqdn(check.data))
      )
    }
  ),
  defineCriterion(
    z.object({ type: z.literal('nslookup'), client: z.string(), name: z.string(), address: z.string() }),
    (state, check) => {
      const client = byName(state, check.client)
      return !!client && firstAddress(resolveName(state, client.id, check.name)) === check.address
    }
  )
]
