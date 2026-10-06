/**
 * Données du rôle Serveur Web (IIS), stockées dans `device.roles.iis`.
 */
import { z } from 'zod'

/** Liaison d'un site : protocole, adresse IP (* = toutes), port, en-tête d'hôte, certificat. */
export const IisBindingSchema = z.object({
  protocol: z.enum(['http', 'https']).default('http'),
  ip: z.string().default('*'),
  port: z.number().int().min(1).max(65535),
  /** Nom d'hôte (vide = tous les noms). */
  host: z.string().default(''),
  /** Empreinte du certificat SSL (liaisons https). */
  certificate: z.string().nullable().default(null)
})

export const IisSiteSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  /** Dossier racine (C:\inetpub\wwwroot). */
  physicalPath: z.string(),
  state: z.enum(['Started', 'Stopped']).default('Started'),
  bindings: z.array(IisBindingSchema).default([])
})

export const IisServerSchema = z.object({
  sites: z.array(IisSiteSchema).default([])
})

export type IisBinding = z.infer<typeof IisBindingSchema>
export type IisSite = z.infer<typeof IisSiteSchema>
export type IisServer = z.infer<typeof IisServerSchema>
