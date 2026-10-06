/**
 * Critères de lab du rôle IIS.
 */
import { z } from 'zod'
import { hostByName, serverByName } from '../../labs/lookup'
import { defineCriterion } from '../types'
import { httpGet } from './http'
import { iisServerOf } from './state'

export const iisCriteria = [
  defineCriterion(
    z.object({
      type: z.literal('iisSite'),
      server: z.string(),
      name: z.string(),
      started: z.boolean().optional(),
      /** Liaison attendue (protocole, port, en-tête d'hôte). */
      protocol: z.enum(['http', 'https']).optional(),
      port: z.number().int().optional(),
      host: z.string().optional()
    }),
    (state, check) => {
      const site = iisServerOf(serverByName(state, check.server))?.sites.find(
        (s) => s.name.toLowerCase() === check.name.toLowerCase()
      )
      if (!site) return false
      if (check.started !== undefined && (site.state === 'Started') !== check.started) return false
      return site.bindings.some(
        (b) =>
          (check.protocol === undefined || b.protocol === check.protocol) &&
          (check.port === undefined || b.port === check.port) &&
          (check.host === undefined || b.host === check.host.toLowerCase())
      )
    }
  ),
  defineCriterion(
    z.object({
      type: z.literal('httpResponse'),
      from: z.string(),
      url: z.string(),
      status: z.number().int().default(200),
      /** HTTPS : le certificat doit être approuvé par le client (aucun avertissement). */
      trusted: z.boolean().optional()
    }),
    (state, check) => {
      const client = hostByName(state, check.from)
      if (!client) return false
      const r = httpGet(state, client.id, check.url)
      if (r.kind !== 'response' || r.status !== check.status) return false
      return check.trusted === undefined || (r.certificateWarning === null) === check.trusted
    }
  )
]
