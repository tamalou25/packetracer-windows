/**
 * Module du rôle Hyper-V : machines virtuelles et commutateurs virtuels hébergés par le serveur.
 */
import { defineRole } from '../types'
import { hypervCmdlets } from './cmdlets'
import { hypervCommands } from './commands'
import { hypervCriteria } from './criteria'
import { HYPERV_STATE, hyperVOf } from './state'

export const hypervRole = defineRole({
  id: 'hyperv',
  displayName: 'Hyper-V',
  feature: 'Hyper-V',
  dependencies: [],
  features: [
    {
      name: 'Hyper-V',
      displayName: 'Hyper-V',
      role: true,
      managementTools: ['RSAT-Hyper-V-Tools', 'Hyper-V-Tools', 'Hyper-V-PowerShell']
    },
    { name: 'RSAT-Hyper-V-Tools', displayName: 'Outils Hyper-V', role: false },
    {
      name: 'Hyper-V-Tools',
      displayName: 'Gestionnaire Hyper-V',
      role: false,
      parent: 'RSAT-Hyper-V-Tools'
    },
    {
      name: 'Hyper-V-PowerShell',
      displayName: 'Module Hyper-V pour Windows PowerShell',
      role: false,
      parent: 'RSAT-Hyper-V-Tools'
    }
  ],
  state: HYPERV_STATE,
  commands: hypervCommands,
  cmdlets: hypervCmdlets,
  tools: [],
  views: [
    {
      app: 'hypervmgr',
      label: 'Gestionnaire Hyper-V',
      run: ['virtmgmt.msc'],
      tool: true,
      requires: { feature: 'Hyper-V-Tools' }
    }
  ],
  criteria: hypervCriteria,
  backgroundTasks: [],
  events: { sources: ['Hyper-V-VMMS'] },
  services: [{ display: 'Gestion d’ordinateurs virtuels Hyper-V', name: 'vmms', when: 'installed' }],
  // Les machines et commutateurs virtuels doivent être supprimés avant le rôle
  uninstallBlocked(state, deviceId, feature) {
    if (feature !== 'Hyper-V') return null
    const hv = hyperVOf(state.devices[deviceId])
    if (hv && (hv.vms.length > 0 || hv.switches.length > 0))
      return {
        code: 'HyperVInUse',
        message:
          'Le rôle Hyper-V ne peut pas être supprimé : supprimez d’abord les machines virtuelles et les commutateurs virtuels.'
      }
    return null
  }
})
