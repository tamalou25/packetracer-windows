/**
 * Rôles et fonctionnalités serveur (équivalent d'Install-WindowsFeature / « Ajouter des rôles »).
 */
import type { Draft } from 'immer'
import { logEvent } from '../core/eventlog'
import { raise, transact, type EngineResult } from '../core/result'
import type { LabState, ServerDevice } from '../model/schema'
import { requireDevice } from '../topology/actions'
import { createDhcpServer } from './dhcp'
import { createDnsServer } from './dns'

export interface FeatureInfo {
  name: string
  displayName: string
  /** Rôle (true) ou simple fonctionnalité. */
  role: boolean
  /** Fonctionnalités installées en même temps (dépendances obligatoires). */
  requires?: string[]
  /** Outils d'administration ajoutés avec -IncludeManagementTools. */
  managementTools?: string[]
  /** Fonctionnalité parente (affichage arborescent). */
  parent?: string
}

/** Catalogue des rôles et fonctionnalités simulés. */
export const FEATURES: FeatureInfo[] = [
  {
    name: 'AD-Domain-Services',
    displayName: 'Services AD DS',
    role: true,
    requires: ['GPMC', 'RSAT-AD-PowerShell'],
    managementTools: ['RSAT-AD-Tools', 'RSAT-ADDS']
  },
  { name: 'DHCP', displayName: 'Serveur DHCP', role: true, managementTools: ['RSAT-DHCP'] },
  { name: 'DNS', displayName: 'Serveur DNS', role: true, managementTools: ['RSAT-DNS-Server'] },
  { name: 'FileAndStorage-Services', displayName: 'Services de fichiers et de stockage', role: true },
  {
    name: 'FS-FileServer',
    displayName: 'Serveur de fichiers',
    role: true,
    parent: 'FileAndStorage-Services'
  },
  { name: 'GPMC', displayName: 'Gestion des stratégies de groupe', role: false },
  { name: 'PowerShell', displayName: 'PowerShell 5.1', role: false },
  { name: 'RSAT-AD-Tools', displayName: 'Outils AD DS et AD LDS', role: false },
  {
    name: 'RSAT-AD-PowerShell',
    displayName: 'Module Active Directory pour PowerShell',
    role: false,
    parent: 'RSAT-AD-Tools'
  },
  { name: 'RSAT-ADDS', displayName: 'Outils AD DS', role: false, parent: 'RSAT-AD-Tools' },
  { name: 'RSAT-DHCP', displayName: 'Outils du serveur DHCP', role: false },
  { name: 'RSAT-DNS-Server', displayName: 'Outils du serveur DNS', role: false }
]

export function featureInfo(name: string): FeatureInfo | undefined {
  const lower = name.toLowerCase()
  return FEATURES.find((f) => f.name.toLowerCase() === lower)
}

export function hasFeature(device: { host: { features: string[] } }, name: string): boolean {
  return device.host.features.includes(name)
}

export interface InstallResult {
  /** Fonctionnalités réellement ajoutées. */
  installed: FeatureInfo[]
  restartNeeded: boolean
}

/** Installe des rôles/fonctionnalités sur un serveur (dépendances incluses). */
export function installFeatures(
  state: LabState,
  deviceId: string,
  names: string[],
  options: { includeManagementTools?: boolean } = {}
): EngineResult<InstallResult> {
  return transact(state, (draft) => {
    const device = requireDevice(draft, deviceId)
    if (device.kind !== 'server')
      raise('NotServer', 'Les rôles ne peuvent être installés que sur un serveur.')
    if (!device.powered) raise('PoweredOff', `${device.name} est éteint.`)
    const toInstall: FeatureInfo[] = []
    const queue = [...names]
    while (queue.length > 0) {
      const name = queue.shift() as string
      const info = featureInfo(name)
      if (!info)
        raise(
          'ArgumentNotValid',
          `La fonctionnalité « ${name} » est introuvable. Vérifiez le nom et réessayez.`
        )
      if (toInstall.some((f) => f.name === info.name)) continue
      toInstall.push(info)
      queue.push(...(info.requires ?? []))
      if (options.includeManagementTools) queue.push(...(info.managementTools ?? []))
      if (info.parent) queue.push(info.parent)
    }
    const installed = toInstall.filter((f) => !device.host.features.includes(f.name))
    for (const f of installed) {
      device.host.features.push(f.name)
      onFeatureInstalled(draft, device, f.name)
    }
    if (installed.length > 0) {
      logEvent(draft, deviceId, {
        level: 'information',
        source: 'Gestionnaire de serveur',
        eventId: 1610,
        log: 'Application',
        message: `Installation réussie : ${installed.map((f) => f.displayName).join(', ')}.`
      })
    }
    return { installed, restartNeeded: false }
  })
}

/** Désinstalle des rôles/fonctionnalités. */
export function uninstallFeatures(
  state: LabState,
  deviceId: string,
  names: string[]
): EngineResult<InstallResult> {
  return transact(state, (draft) => {
    const device = requireDevice(draft, deviceId)
    if (device.kind !== 'server') raise('NotServer', 'Opération réservée aux serveurs.')
    const removed: FeatureInfo[] = []
    for (const name of names) {
      const info = featureInfo(name)
      if (!info) raise('ArgumentNotValid', `La fonctionnalité « ${name} » est introuvable.`)
      if (info.name === 'AD-Domain-Services' && isDomainControllerDraft(device))
        raise(
          'DcRoleRemoval',
          'Le rôle Services AD DS ne peut pas être supprimé tant que le serveur est contrôleur de domaine. Rétrogradez-le d’abord.'
        )
      const index = device.host.features.indexOf(info.name)
      if (index >= 0) {
        device.host.features.splice(index, 1)
        onFeatureRemoved(draft, device, info.name)
        removed.push(info)
      }
    }
    return { installed: removed, restartNeeded: false }
  })
}

/** Initialise les données d'un rôle à son installation. */
function onFeatureInstalled(_draft: Draft<LabState>, device: Draft<ServerDevice>, name: string): void {
  if (name === 'DHCP' && !device.services.dhcp) device.services.dhcp = createDhcpServer()
  if (name === 'DNS' && !device.services.dns) device.services.dns = createDnsServer()
}

function onFeatureRemoved(_draft: Draft<LabState>, _device: Draft<ServerDevice>, _name: string): void {
  // Les données propres aux rôles sont conservées (comme une désinstallation sans suppression de la base).
}

function isDomainControllerDraft(_device: Draft<ServerDevice>): boolean {
  return false
}
