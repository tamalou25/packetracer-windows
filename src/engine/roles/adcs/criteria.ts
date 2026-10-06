/**
 * Critères de lab du rôle AD CS.
 */
import { z } from 'zod'
import { hostByName, serverByName } from '../../labs/lookup'
import { certificateCovers, certificateTrusted } from '../../services/certificates'
import { defineCriterion } from '../types'
import { isRevoked } from './actions'
import { adcsOf, templateName } from './state'

export const adcsCriteria = [
  defineCriterion(
    z.object({ type: z.literal('enterpriseCa'), server: z.string(), name: z.string().optional() }),
    (state, check) => {
      const ca = adcsOf(serverByName(state, check.server))
      return (
        !!ca?.configured && (check.name === undefined || ca.caName.toLowerCase() === check.name.toLowerCase())
      )
    }
  ),
  defineCriterion(
    z.object({
      type: z.literal('caTemplate'),
      server: z.string(),
      template: z.string(),
      published: z.boolean().default(true)
    }),
    (state, check) => {
      const ca = adcsOf(serverByName(state, check.server))
      const short = templateName(check.template)
      return !!ca?.configured && !!short && ca.templates.includes(short) === (check.published !== false)
    }
  ),
  defineCriterion(
    z.object({
      type: z.literal('certificate'),
      /** Ordinateur qui détient le certificat (magasin Personnel). */
      device: z.string(),
      /** Nom DNS couvert. */
      dnsName: z.string().optional(),
      /** Délivré par une autorité de certification (pas auto-signé). */
      fromCa: z.boolean().optional(),
      /** Ordinateur qui doit l'approuver (certificat racine dans son magasin). */
      trustedBy: z.string().optional(),
      revoked: z.boolean().optional()
    }),
    (state, check) => {
      const host = hostByName(state, check.device)
      const trustee = check.trustedBy ? hostByName(state, check.trustedBy) : undefined
      if (!host || (check.trustedBy && !trustee)) return false
      return host.host.certificates.some(
        (c) =>
          c.store === 'My' &&
          !c.ca &&
          (check.dnsName === undefined || certificateCovers(c, check.dnsName)) &&
          (check.fromCa === undefined || (c.issuerThumbprint !== null) === check.fromCa) &&
          (!trustee || certificateTrusted(trustee, c)) &&
          (check.revoked === undefined || isRevoked(state, c) === check.revoked)
      )
    }
  )
]
