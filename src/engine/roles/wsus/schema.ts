/**
 * Données du rôle WSUS (stockées dans `device.roles.wsus`).
 */
import { z } from 'zod'

/** Classifications des mises à jour (identifiants internes, libellés dans `catalog.ts`). */
export const WSUS_CLASSIFICATIONS = [
  'critical',
  'security',
  'definition',
  'drivers',
  'featurepacks',
  'servicepacks',
  'tools',
  'rollups',
  'updates',
  'upgrades'
] as const

export const WsusClassificationSchema = z.enum(WSUS_CLASSIFICATIONS)

export const WsusServerSchema = z.object({
  /** Tâches de post-installation terminées (emplacement du contenu choisi). */
  configured: z.boolean().default(false),
  /** Dossier local de stockage des mises à jour (C:\WSUS). */
  contentDir: z.string().default(''),
  /** Classifications synchronisées. */
  classifications: z.array(WsusClassificationSchema).default(['critical', 'security']),
  /** Dernière synchronisation (horloge du lab), null si jamais synchronisé. */
  lastSync: z.number().nullable().default(null),
  /** Mises à jour synchronisées (identifiants du catalogue). */
  updates: z.array(z.string()).default([]),
  /** Ciblage : console Update Services (serveur) ou stratégie de groupe (client). */
  targeting: z.enum(['server', 'client']).default('server'),
  /** Groupes d'ordinateurs créés par l'administrateur (sous « Tous les ordinateurs »). */
  groups: z.array(z.string()).default([]),
  /** Appartenance choisie dans la console (ciblage côté serveur). */
  assignments: z.array(z.object({ computerId: z.string(), group: z.string() })).default([]),
  /** Approbations « Installer » par groupe. */
  approvals: z.array(z.object({ updateId: z.string(), group: z.string() })).default([]),
  /** Mises à jour refusées. */
  declined: z.array(z.string()).default([])
})

export type WsusClassification = z.infer<typeof WsusClassificationSchema>
export type WsusServer = z.infer<typeof WsusServerSchema>
