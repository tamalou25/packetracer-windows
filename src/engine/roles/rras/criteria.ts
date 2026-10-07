/**
 * Critères de lab RRAS : NAT actif, client VPN connecté.
 */
import { z } from 'zod'
import { hostByName, serverByName } from '../../labs/lookup'
import { defineCriterion } from '../types'
import { natEnabled, rrasOf } from './state'

export const rrasCriteria = [
  defineCriterion(
    z.object({ type: z.literal('natEnabled'), server: z.string() }),
    (state, check) => natEnabled(rrasOf(serverByName(state, check.server))),
    'NAT activé'
  ),
  defineCriterion(
    z.object({ type: z.literal('vpnConnected'), client: z.string(), server: z.string().optional() }),
    (state, check) => {
      const client = hostByName(state, check.client)
      const server = check.server ? serverByName(state, check.server) : undefined
      return !!client?.host.vpnConnections.some(
        (c) => !!c.connected && (!server || c.connected.serverDeviceId === server.id)
      )
    },
    'Client VPN connecté'
  )
]
