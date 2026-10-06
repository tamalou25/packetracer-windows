/**
 * Données du rôle Services de certificats Active Directory (`device.roles.adcs`) : autorité de
 * certification racine d'entreprise, modèles publiés et certificats délivrés.
 */
import { z } from 'zod'

export const IssuedCertificateSchema = z.object({
  /** Numéro de série (hexadécimal). */
  serial: z.string(),
  thumbprint: z.string(),
  subject: z.string(),
  template: z.string(),
  /** Ordinateur demandeur. */
  requester: z.string(),
  issuedAt: z.number().default(0),
  revoked: z.boolean().default(false),
  revokedAt: z.number().nullable().default(null),
  /** Motif de révocation (KeyCompromise, Superseded…). */
  reason: z.string().nullable().default(null)
})

export const AdcsServerSchema = z.object({
  /** Configuration post-installation terminée (Install-AdcsCertificationAuthority). */
  configured: z.boolean().default(false),
  caName: z.string().default(''),
  caType: z.enum(['EnterpriseRootCA']).default('EnterpriseRootCA'),
  /** Empreinte du certificat de l'autorité. */
  caThumbprint: z.string().nullable().default(null),
  /** Modèles de certificats publiés (noms courts : WebServer, Machine…). */
  templates: z.array(z.string()).default([]),
  issued: z.array(IssuedCertificateSchema).default([])
})

export type IssuedCertificate = z.infer<typeof IssuedCertificateSchema>
export type AdcsServer = z.infer<typeof AdcsServerSchema>
