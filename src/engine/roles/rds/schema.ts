/**
 * Données du rôle Services Bureau à distance (stockées dans `device.roles.rds`) : collections de
 * sessions d'un déploiement à serveur unique (Service Broker, Accès Web et hôte de session).
 */
import { z } from 'zod'

export const RemoteAppSchema = z.object({
  /** Alias (identifiant du programme). */
  alias: z.string(),
  displayName: z.string(),
  /** Chemin de l'exécutable sur l'hôte de session. */
  filePath: z.string()
})

export const SessionCollectionSchema = z.object({
  name: z.string(),
  description: z.string().default(''),
  /** Groupes d'utilisateurs autorisés à se connecter (DOMAINE\\nom). */
  userGroups: z.array(z.string()).default([]),
  remoteApps: z.array(RemoteAppSchema).default([])
})

export const RdsServerSchema = z.object({
  collections: z.array(SessionCollectionSchema).default([])
})

export type RemoteApp = z.infer<typeof RemoteAppSchema>
export type SessionCollection = z.infer<typeof SessionCollectionSchema>
export type RdsServer = z.infer<typeof RdsServerSchema>
