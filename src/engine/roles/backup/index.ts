/**
 * Module Sauvegarde Windows Server (sauvegarde, planification, récupération de fichiers).
 * La Corbeille Active Directory est déclarée par le module AD DS ; son critère de lab est ici.
 */
import { defineRole } from '../types'
import { backupCommands } from './commands'
import { backupCriteria } from './criteria'
import { BACKUP_STATE } from './state'
import { wbadminTool } from './tools'

export const backupRole = defineRole({
  id: 'backup',
  displayName: 'Sauvegarde Windows Server',
  feature: 'Windows-Server-Backup',
  dependencies: ['files'],
  features: [{ name: 'Windows-Server-Backup', displayName: 'Sauvegarde Windows Server', role: false }],
  state: BACKUP_STATE,
  commands: backupCommands,
  cmdlets: [],
  tools: [wbadminTool],
  views: [
    {
      app: 'wbadmin',
      label: 'Sauvegarde Windows Server',
      run: ['wbadmin.msc'],
      tool: true,
      requires: { feature: 'Windows-Server-Backup' }
    }
  ],
  criteria: backupCriteria,
  backgroundTasks: [],
  events: { sources: ['Backup'] },
  services: [{ display: 'Service de moteur de sauvegarde en mode bloc', name: 'wbengine', when: 'installed' }]
})
