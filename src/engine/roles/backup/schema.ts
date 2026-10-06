/**
 * Données de la fonctionnalité Sauvegarde Windows Server (`device.roles.backup`) : stratégie de
 * sauvegarde planifiée et historique des sauvegardes (copie des fichiers sauvegardés).
 */
import { z } from 'zod'
import { NtfsAceSchema } from '../../model/schema'

export const BackupPolicySchema = z.object({
  /** Dossiers ou fichiers à sauvegarder (chemins locaux). */
  items: z.array(z.string()).default([]),
  systemState: z.boolean().default(false),
  /** Destination (disque dédié E:, volume, ou partage \\serveur\partage). */
  target: z.string(),
  /** Heure quotidienne (HH:MM). */
  time: z.string()
})

export const BackupEntrySchema = z.object({
  path: z.string(),
  kind: z.enum(['folder', 'file']),
  size: z.number().default(0),
  modifiedAt: z.number().default(0),
  acl: z.array(NtfsAceSchema).default([]),
  inherits: z.boolean().default(true),
  owner: z.string().default('')
})

export const BackupSetSchema = z.object({
  /** Identificateur de version (jj/mm/aaaa-hh:mm). */
  version: z.string(),
  time: z.number(),
  target: z.string(),
  items: z.array(z.string()).default([]),
  systemState: z.boolean().default(false),
  entries: z.array(BackupEntrySchema).default([])
})

export const BackupStateSchema = z.object({
  policy: BackupPolicySchema.nullable().default(null),
  sets: z.array(BackupSetSchema).default([])
})

export type BackupPolicy = z.infer<typeof BackupPolicySchema>
export type BackupSet = z.infer<typeof BackupSetSchema>
export type BackupState = z.infer<typeof BackupStateSchema>
