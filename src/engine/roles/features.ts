/**
 * Installation des rôles et fonctionnalités serveur (Install-WindowsFeature, « Ajouter des
 * rôles »). Le catalogue et les données initiales des rôles viennent du registre.
 */
import type { Draft } from 'immer'
import { logEvent } from '../core/eventlog'
import { raise, transact, type EngineResult } from '../core/result'
import type { LabState, ServerDevice } from '../model/schema'
import { requireDevice } from '../topology/actions'
import { allFeatures, featureInfo, roleModules } from './registry'
import { ensureRoleState } from './state'
import type { FeatureInfo } from './types'

export { allFeatures, featureInfo }
export type { FeatureInfo }

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
      const blocked = roleModules()
        .map((m) => m.uninstallBlocked?.(draft as LabState, deviceId, info.name) ?? null)
        .find((b) => b !== null)
      if (blocked) raise(blocked.code, blocked.message)
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

/** Initialise les données d'un rôle à son installation (état initial déclaré par le module). */
function onFeatureInstalled(_draft: Draft<LabState>, device: Draft<ServerDevice>, name: string): void {
  for (const module of roleModules()) {
    const def = module.state
    if (!def || def.feature !== name) continue
    ensureRoleState(device, def)
  }
}

function onFeatureRemoved(_draft: Draft<LabState>, _device: Draft<ServerDevice>, _name: string): void {
  // Les données propres aux rôles sont conservées (comme une désinstallation sans suppression de la base).
}
