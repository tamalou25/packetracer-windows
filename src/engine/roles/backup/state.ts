/**
 * Données de Sauvegarde Windows Server sur un serveur : définition (registre, validation) et accesseur.
 */
import { roleState } from '../state'
import type { RoleStateDef } from '../types'
import { BackupStateSchema, type BackupState } from './schema'

export const BACKUP_STATE: RoleStateDef<BackupState> = {
  key: 'backup',
  feature: 'Windows-Server-Backup',
  schema: BackupStateSchema,
  create: () => ({ policy: null, sets: [] })
}

export const backupOf = (device: Parameters<typeof roleState>[0]): BackupState | null =>
  roleState(device, BACKUP_STATE)
