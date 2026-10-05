/**
 * Opérations système : redémarrage, renommage de l'ordinateur.
 */
import type { Draft } from 'immer'
import { logEvent } from '../core/eventlog'
import { raise, transact, type EngineResult } from '../core/result'
import { DEFAULT_LOCAL_USER } from '../model/factory'
import type { HostDevice, LabState } from '../model/schema'
import { deviceNameError, requireDevice } from '../topology/actions'

/** Applique les opérations en attente d'un redémarrage (renommage…). */
export function applyRestart(draft: Draft<LabState>, device: Draft<HostDevice>): void {
  logEvent(draft, device.id, {
    level: 'information',
    source: 'User32',
    eventId: 1074,
    message: `Le processus a déclenché le redémarrage de l’ordinateur ${device.name} pour le compte ${device.host.session?.user ?? 'SYSTEM'}.`
  })
  logEvent(draft, device.id, {
    level: 'information',
    source: 'EventLog',
    eventId: 6006,
    message: 'Le service Journal des événements a été arrêté.'
  })
  if (device.host.pendingName) {
    device.name = device.host.pendingName
    device.host.pendingName = null
  }
  device.host.pendingReboot = false
  // Les baux DHCP sont redemandés au démarrage
  for (const iface of device.interfaces) {
    if (iface.addressing === 'dhcp') iface.dhcpLease = null
  }
  // Session : un serveur se reconnecte en administrateur, un poste du domaine revient à l'écran de connexion
  if (device.kind === 'client' && device.host.domain) device.host.session = null
  else if (device.kind === 'server' && !device.host.session)
    device.host.session = { user: DEFAULT_LOCAL_USER.server, domain: null }
  logEvent(draft, device.id, {
    level: 'information',
    source: 'EventLog',
    eventId: 6005,
    message: 'Le service Journal des événements a été démarré.'
  })
}

/** Redémarre un serveur ou un poste. */
export function restartComputer(state: LabState, deviceId: string): EngineResult {
  return transact(state, (draft) => {
    const device = requireDevice(draft, deviceId)
    if (device.kind !== 'server' && device.kind !== 'client')
      raise('NotSupported', 'Équipement non redémarrable.')
    if (!device.powered) raise('PoweredOff', `${device.name} est éteint.`)
    applyRestart(draft, device)
    return undefined
  })
}

/** Renomme l'ordinateur ; effectif au prochain redémarrage. */
export function renameComputer(state: LabState, deviceId: string, newName: string): EngineResult {
  return transact(state, (draft) => {
    const device = requireDevice(draft, deviceId)
    if (device.kind !== 'server' && device.kind !== 'client')
      raise('NotSupported', 'Équipement non renommable.')
    const name = newName.trim()
    const err = deviceNameError(device.kind, name)
    if (err) raise('InvalidName', err)
    const upper = name.toUpperCase()
    if (Object.values(draft.devices).some((d) => d.id !== deviceId && d.name.toUpperCase() === upper))
      raise('DuplicateName', `Le nom « ${name} » est déjà utilisé par un autre ordinateur du réseau.`)
    if (name.toUpperCase() === device.name.toUpperCase())
      raise(
        'SameName',
        `Impossible de renommer l’ordinateur « ${device.name} » en « ${name} », car le nouveau nom est identique à l’actuel.`
      )
    device.host.pendingName = name
    device.host.pendingReboot = true
    return undefined
  })
}
