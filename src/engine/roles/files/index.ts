/**
 * Module du rôle Services de fichiers : NTFS, partages SMB, lecteurs réseau.
 * Le volume C: existe sur tout serveur (`device.storage`), le rôle apporte le partage.
 */
import { defineRole } from '../types'
import { fileCmdlets } from './cmdlets'
import { filesCommands } from './commands'
import { filesCriteria } from './criteria'
import { fileTools } from './tools'

export const filesRole = defineRole({
  id: 'files',
  displayName: 'Services de fichiers et de stockage',
  feature: 'FileAndStorage-Services',
  dependencies: [],
  features: [
    { name: 'FileAndStorage-Services', displayName: 'Services de fichiers et de stockage', role: true },
    {
      name: 'FS-FileServer',
      displayName: 'Serveur de fichiers',
      role: true,
      parent: 'FileAndStorage-Services'
    }
  ],
  commands: filesCommands,
  cmdlets: fileCmdlets,
  tools: fileTools,
  views: [
    { app: 'fileprops', label: 'Propriétés', dialog: true, requires: { server: true } },
    { app: 'newshare', label: 'Assistant Nouveau partage', dialog: true, requires: { server: true } }
  ],
  criteria: filesCriteria,
  backgroundTasks: [],
  events: { sources: ['Srv', 'LanmanServer'] },
  services: [{ display: 'Serveur', name: 'LanmanServer', when: 'always' }]
})
