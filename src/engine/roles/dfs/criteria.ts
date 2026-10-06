/**
 * Critères de lab du rôle DFS.
 */
import { z } from 'zod'
import { hostByName, serverByName } from '../../labs/lookup'
import { findNode } from '../files/paths'
import { openUnc } from '../files/smb'
import { sessionToken } from '../files/acl'
import { defineCriterion } from '../types'
import { findGroup } from './replication'
import { findNamespace } from './state'

export const dfsCriteria = [
  defineCriterion(
    z.object({
      type: z.literal('dfsNamespace'),
      domain: z.string(),
      name: z.string(),
      folder: z.string().optional(),
      /** Nombre minimal de cibles du dossier. */
      targets: z.number().int().optional()
    }),
    (state, check) => {
      const found = findNamespace(state, check.domain, check.name)
      if (!found) return false
      if (!check.folder) return true
      const folder = found.namespace.folders.find((f) => f.name.toLowerCase() === check.folder?.toLowerCase())
      return !!folder && folder.targets.length >= (check.targets ?? 1)
    }
  ),
  defineCriterion(
    z.object({
      type: z.literal('uncReachable'),
      /** Ordinateur client : accès avec le compte de la session ouverte. */
      from: z.string(),
      path: z.string()
    }),
    (state, check) => {
      const client = hostByName(state, check.from)
      if (!client) return false
      const token = sessionToken(state, client.id)
      return !!token && openUnc(state, client.id, check.path, token).ok
    }
  ),
  defineCriterion(
    z.object({
      type: z.literal('dfsReplicated'),
      group: z.string(),
      /** Élément qui doit exister sur chaque serveur (chemin local). */
      server: z.string(),
      path: z.string()
    }),
    (state, check) => {
      const server = serverByName(state, check.server)
      const found = findGroup(state, check.group)
      if (!server || !found || !found.group.members.includes(server.id)) return false
      return !!findNode(server.storage, check.path)
    }
  )
]
