/**
 * Données du rôle DFS (`device.roles.dfs`) : espaces de noms de domaine hébergés par ce serveur et
 * groupes de réplication créés depuis ce serveur.
 */
import { z } from 'zod'

export const NamespaceFolderSchema = z.object({
  name: z.string(),
  /** Cibles du dossier (\\SRV1\Compta, \\SRV2\Compta), par ordre de préférence. */
  targets: z.array(z.string()).default([])
})

export const NamespaceSchema = z.object({
  /** Nom de la racine (\\lab.local\<nom>). */
  name: z.string(),
  /** Dossier local de la racine (C:\DFSRoots\<nom>), partagé sous le même nom. */
  rootPath: z.string(),
  folders: z.array(NamespaceFolderSchema).default([])
})

/** Élément connu lors de la dernière réplication (chemin relatif au dossier répliqué). */
export const ReplicaEntrySchema = z.object({
  path: z.string(),
  kind: z.enum(['folder', 'file']),
  size: z.number().default(0),
  modifiedAt: z.number().default(0)
})

export const ReplicatedFolderSchema = z.object({
  name: z.string(),
  /** Chemin local par membre (identifiant d'équipement → C:\Compta). */
  paths: z.record(z.string(), z.string()).default({}),
  /** Membre principal (fait autorité lors de la réplication initiale). */
  primary: z.string().nullable().default(null),
  /** État après la dernière réplication (détection des ajouts, modifications et suppressions). */
  snapshot: z.array(ReplicaEntrySchema).default([]),
  /** Éléments (chemins en minuscules) présents sur chaque membre après sa dernière réplication. */
  synced: z.record(z.string(), z.array(z.string())).default({}),
  lastSync: z.number().nullable().default(null)
})

export const ReplicationGroupSchema = z.object({
  name: z.string(),
  /** Membres (identifiants d'équipements). */
  members: z.array(z.string()).default([]),
  folders: z.array(ReplicatedFolderSchema).default([])
})

export const DfsServerSchema = z.object({
  namespaces: z.array(NamespaceSchema).default([]),
  groups: z.array(ReplicationGroupSchema).default([])
})

export type Namespace = z.infer<typeof NamespaceSchema>
export type ReplicaEntry = z.infer<typeof ReplicaEntrySchema>
export type ReplicatedFolder = z.infer<typeof ReplicatedFolderSchema>
export type ReplicationGroup = z.infer<typeof ReplicationGroupSchema>
export type DfsServer = z.infer<typeof DfsServerSchema>
