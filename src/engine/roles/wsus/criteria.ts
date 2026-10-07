/**
 * Critères de lab du rôle WSUS.
 */
import { z } from 'zod'
import { hostByName, serverByName } from '../../labs/lookup'
import { defineCriterion } from '../types'
import { catalogUpdate } from './catalog'
import { wsusClientStatus, wsusComputers } from './client'
import { findWsusGroup, wsusServerOf } from './state'

export const wsusCriteria = [
  defineCriterion(
    z.object({ type: z.literal('wsusSynchronized'), server: z.string() }),
    (state, check) => (wsusServerOf(serverByName(state, check.server))?.updates.length ?? 0) > 0,
    'WSUS synchronisé'
  ),
  defineCriterion(
    z.object({ type: z.literal('wsusApproval'), server: z.string(), update: z.string(), group: z.string() }),
    (state, check) => {
      const wsus = wsusServerOf(serverByName(state, check.server))
      const group = wsus ? findWsusGroup(wsus, check.group) : null
      const id = catalogUpdate(check.update)?.id
      return !!wsus && !!group && wsus.approvals.some((a) => a.updateId === id && a.group === group)
    },
    'Mise à jour WSUS approuvée'
  ),
  defineCriterion(
    z.object({
      type: z.literal('wsusComputerGroup'),
      server: z.string(),
      computer: z.string(),
      group: z.string()
    }),
    (state, check) => {
      const server = serverByName(state, check.server)
      const computer = hostByName(state, check.computer)
      if (!server || !computer) return false
      const entry = wsusComputers(state, server.id).find((c) => c.deviceId === computer.id)
      return entry?.group.toLowerCase() === check.group.toLowerCase()
    },
    'Groupe d’ordinateurs WSUS'
  ),
  defineCriterion(
    z.object({
      type: z.literal('wsusClientUpdate'),
      client: z.string(),
      update: z.string(),
      /** true : le poste doit recevoir la mise à jour ; false : il ne doit pas la recevoir. */
      received: z.boolean().default(true)
    }),
    (state, check) => {
      const client = hostByName(state, check.client)
      if (!client) return false
      const status = wsusClientStatus(state, client.id)
      if (status.kind !== 'ok') return false
      const id = catalogUpdate(check.update)?.id
      return status.updates.some((u) => u.id === id) === (check.received !== false)
    },
    'Mise à jour reçue par un client WSUS'
  )
]
