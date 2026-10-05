/**
 * Actions de topologie : ajout/suppression d'équipements, câblage, renommage…
 * Toutes les actions sont pures : (état, paramètres) → EngineResult.
 */
import type { Draft } from 'immer'
import { logEvent } from '../core/eventlog'
import { raise, transact, type EngineResult } from '../core/result'
import { buildDevice, createInterface, SERVER_MAX_INTERFACES, nextSeq } from '../model/factory'
import type { DeviceKind } from '../model/kinds'
import type { Device, LabState, LinkEnd, Position } from '../model/schema'
import { linkOnInterface } from './queries'

/** Récupère un équipement dans un brouillon, ou lève une erreur. */
export function requireDevice(draft: Draft<LabState>, id: string): Draft<Device> {
  const device = draft.devices[id]
  if (!device) raise('DeviceNotFound', `Équipement introuvable (${id}).`)
  return device
}

/**
 * Valide un nom d'équipement.
 * Serveurs et postes suivent les règles NetBIOS (15 caractères, lettres, chiffres, tirets).
 */
export function deviceNameError(kind: DeviceKind, name: string): string | null {
  const n = name.trim()
  if (n.length === 0) return 'Le nom ne peut pas être vide.'
  if (kind === 'server' || kind === 'client') {
    if (n.length > 15) return 'Le nom de l’ordinateur ne peut pas dépasser 15 caractères.'
    if (!/^[A-Za-z0-9-]+$/.test(n))
      return 'Le nom ne peut contenir que des lettres, des chiffres et des tirets.'
    if (/^\d+$/.test(n)) return 'Le nom ne peut pas être composé uniquement de chiffres.'
    if (n.startsWith('-') || n.endsWith('-')) return 'Le nom ne peut pas commencer ni finir par un tiret.'
    return null
  }
  if (n.length > 32) return 'Le nom ne peut pas dépasser 32 caractères.'
  if (!/^[A-Za-z0-9_-]+$/.test(n))
    return 'Le nom ne peut contenir que des lettres, des chiffres, « - » et « _ ».'
  return null
}

function assertNameAvailable(draft: Draft<LabState>, name: string, exceptId?: string): void {
  const upper = name.toUpperCase()
  const taken = Object.values(draft.devices).some((d) => d.id !== exceptId && d.name.toUpperCase() === upper)
  if (taken) raise('DuplicateName', `Un équipement nommé « ${name} » existe déjà dans la topologie.`)
}

export interface AddDeviceParams {
  kind: DeviceKind
  position: Position
  name?: string
}

/** Ajoute un équipement et renvoie son identifiant. */
export function addDevice(state: LabState, params: AddDeviceParams): EngineResult<string> {
  return transact(state, (draft) => {
    if (params.name !== undefined) {
      const err = deviceNameError(params.kind, params.name)
      if (err) raise('InvalidName', err)
      assertNameAvailable(draft, params.name.trim())
    }
    const device = buildDevice(draft, params.kind, params.position, params.name?.trim())
    draft.devices[device.id] = device
    return device.id
  })
}

/** Supprime des équipements et tous les câbles qui y sont branchés. */
export function removeDevices(state: LabState, ids: string[]): EngineResult {
  return transact(state, (draft) => {
    const set = new Set(ids)
    for (const id of ids) requireDevice(draft, id)
    for (const link of Object.values(draft.links)) {
      if (set.has(link.a.deviceId) || set.has(link.b.deviceId)) delete draft.links[link.id]
    }
    for (const id of ids) delete draft.devices[id]
    return undefined
  })
}

/** Déplace un équipement sur le canvas. */
export function moveDevice(state: LabState, id: string, position: Position): EngineResult {
  return transact(state, (draft) => {
    requireDevice(draft, id).position = { x: position.x, y: position.y }
    return undefined
  })
}

export function renameDevice(state: LabState, id: string, name: string): EngineResult {
  return transact(state, (draft) => {
    const device = requireDevice(draft, id)
    const trimmed = name.trim()
    const err = deviceNameError(device.kind, trimmed)
    if (err) raise('InvalidName', err)
    assertNameAvailable(draft, trimmed, id)
    device.name = trimmed
    return undefined
  })
}

/** Allume ou éteint un équipement. */
export function setPower(state: LabState, id: string, powered: boolean): EngineResult {
  return transact(state, (draft) => {
    const device = requireDevice(draft, id)
    if (device.powered === powered) return undefined
    if (!powered) {
      logEvent(draft, id, {
        level: 'information',
        source: 'EventLog',
        eventId: 6006,
        message: 'Le service Journal des événements a été arrêté.'
      })
    }
    device.powered = powered
    if (powered) {
      logEvent(draft, id, {
        level: 'information',
        source: 'EventLog',
        eventId: 6005,
        message: 'Le service Journal des événements a été démarré.'
      })
    }
    return undefined
  })
}

/** Ajoute une carte réseau à un serveur (4 maximum). Renvoie l'identifiant de la carte. */
export function addServerInterface(state: LabState, id: string): EngineResult<string> {
  return transact(state, (draft) => {
    const device = requireDevice(draft, id)
    if (device.kind !== 'server')
      raise('NotSupported', 'Seuls les serveurs peuvent recevoir une carte réseau supplémentaire.')
    if (device.interfaces.length >= SERVER_MAX_INTERFACES)
      raise('LimitReached', `Un serveur ne peut pas avoir plus de ${SERVER_MAX_INTERFACES} cartes réseau.`)
    const used = new Set(device.interfaces.map((i) => i.name))
    let n = 0
    while (used.has(`Ethernet${n}`)) n++
    const iface = createInterface(draft, `Ethernet${n}`, 'server')
    device.interfaces.push(iface)
    return iface.id
  })
}

/** Supprime une carte réseau d'un serveur (et le câble éventuel). La première carte est conservée. */
export function removeServerInterface(state: LabState, id: string, ifaceId: string): EngineResult {
  return transact(state, (draft) => {
    const device = requireDevice(draft, id)
    if (device.kind !== 'server') raise('NotSupported', 'Opération réservée aux serveurs.')
    if (device.interfaces.length <= 1)
      raise('LimitReached', 'Un serveur doit conserver au moins une carte réseau.')
    const index = device.interfaces.findIndex((i) => i.id === ifaceId)
    if (index < 0) raise('InterfaceNotFound', 'Carte réseau introuvable.')
    const link = linkOnInterface(draft, id, ifaceId)
    if (link) delete draft.links[link.id]
    device.interfaces.splice(index, 1)
    return undefined
  })
}

/** Active ou désactive un port / une carte réseau. */
export function setInterfaceEnabled(
  state: LabState,
  deviceId: string,
  ifaceId: string,
  enabled: boolean
): EngineResult {
  return transact(state, (draft) => {
    const iface = requireDevice(draft, deviceId).interfaces.find((i) => i.id === ifaceId)
    if (!iface) raise('InterfaceNotFound', 'Carte réseau introuvable.')
    iface.enabled = enabled
    return undefined
  })
}

/** Relie deux ports par un câble. Renvoie l'identifiant du câble. */
export function connect(state: LabState, a: LinkEnd, b: LinkEnd): EngineResult<string> {
  return transact(state, (draft) => {
    if (a.deviceId === b.deviceId) raise('SameDevice', 'Impossible de relier un équipement à lui-même.')
    for (const end of [a, b]) {
      const device = requireDevice(draft, end.deviceId)
      const iface = device.interfaces.find((i) => i.id === end.ifaceId)
      if (!iface) raise('InterfaceNotFound', `Port introuvable sur ${device.name}.`)
      if (linkOnInterface(draft, end.deviceId, end.ifaceId))
        raise('PortInUse', `Le port ${iface.name} de ${device.name} est déjà utilisé.`)
    }
    const id = `l${nextSeq(draft)}`
    draft.links[id] = { id, a: { ...a }, b: { ...b } }
    return id
  })
}

export function disconnect(state: LabState, linkId: string): EngineResult {
  return transact(state, (draft) => {
    if (!draft.links[linkId]) raise('LinkNotFound', 'Câble introuvable.')
    delete draft.links[linkId]
    return undefined
  })
}

/**
 * Duplique des équipements (copier/coller) avec un décalage.
 * Les câbles entre équipements copiés sont recréés. Les identifiants, MAC et noms sont régénérés ;
 * les baux DHCP et l'appartenance à un domaine ne sont pas copiés.
 * Renvoie les identifiants des nouveaux équipements.
 */
export function duplicateDevices(
  state: LabState,
  source: { devices: Device[]; links: LabState['links'][string][] },
  offset: Position
): EngineResult<string[]> {
  return transact(state, (draft) => {
    const idMap = new Map<string, string>()
    const ifaceMap = new Map<string, string>()
    const created: string[] = []
    for (const original of source.devices) {
      const copy = buildDevice(draft, original.kind, {
        x: original.position.x + offset.x,
        y: original.position.y + offset.y
      })
      // Recopie la configuration des cartes (hors identité matérielle et bail)
      copy.interfaces = original.interfaces.map((iface) => {
        const fresh = createInterface(draft, iface.name, original.kind)
        ifaceMap.set(`${original.id}/${iface.id}`, fresh.id)
        return {
          ...iface,
          id: fresh.id,
          mac: fresh.mac,
          dnsServers: [...iface.dnsServers],
          dhcpLease: null
        }
      })
      if (copy.kind === 'router' && original.kind === 'router')
        copy.routes = original.routes.map((r) => ({ ...r }))
      if (
        (copy.kind === 'server' || copy.kind === 'client') &&
        (original.kind === 'server' || original.kind === 'client')
      ) {
        copy.host.features = [...original.host.features]
      }
      draft.devices[copy.id] = copy
      idMap.set(original.id, copy.id)
      created.push(copy.id)
    }
    for (const link of source.links) {
      const da = idMap.get(link.a.deviceId)
      const db = idMap.get(link.b.deviceId)
      const ia = ifaceMap.get(`${link.a.deviceId}/${link.a.ifaceId}`)
      const ib = ifaceMap.get(`${link.b.deviceId}/${link.b.ifaceId}`)
      if (da && db && ia && ib) {
        const id = `l${nextSeq(draft)}`
        draft.links[id] = { id, a: { deviceId: da, ifaceId: ia }, b: { deviceId: db, ifaceId: ib } }
      }
    }
    return created
  })
}
