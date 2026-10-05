/**
 * Fabriques : création d'un lab vide et d'équipements avec leurs valeurs par défaut.
 */
import type { Draft } from 'immer'
import { DEVICE_KIND_INFO, type DeviceKind } from './kinds'
import type { Device, Host, LabState, NetInterface, Position } from './schema'

/** Nombre de ports par type d'équipement. */
export const SWITCH_PORT_COUNT = 16
export const ROUTER_INTERFACE_COUNT = 4
/** Nombre maximal de cartes réseau sur un serveur. */
export const SERVER_MAX_INTERFACES = 4

export function createLab(): LabState {
  return { devices: {}, links: {}, seq: 0, clock: 0 }
}

/** Incrémente le compteur et renvoie la nouvelle valeur. */
export function nextSeq(draft: Draft<LabState>): number {
  draft.seq += 1
  return draft.seq
}

/**
 * Adresse MAC déterministe, préfixe « administré localement » 02-53-4C (« SL »).
 * Format Windows : octets séparés par des tirets.
 */
export function macFromSeq(seq: number): string {
  const hex = seq.toString(16).toUpperCase().padStart(6, '0').slice(-6)
  return `02-53-4C-${hex.slice(0, 2)}-${hex.slice(2, 4)}-${hex.slice(4, 6)}`
}

/** Compte local par défaut (session ouverte automatiquement). */
export const DEFAULT_LOCAL_USER = { server: 'Administrateur', client: 'Utilisateur' } as const

/** Fonctionnalités présentes dès l'installation d'un serveur. */
export const DEFAULT_SERVER_FEATURES = ['FS-FileServer', 'PowerShell']

export function createHost(kind: 'server' | 'client'): Host {
  return {
    workgroup: 'WORKGROUP',
    domain: null,
    features: kind === 'server' ? [...DEFAULT_SERVER_FEATURES] : ['PowerShell'],
    pendingReboot: false,
    pendingName: null,
    session: { user: DEFAULT_LOCAL_USER[kind], domain: null },
    eventLog: []
  }
}

/** Crée une carte réseau avec un identifiant et une MAC uniques. */
export function createInterface(draft: Draft<LabState>, name: string, kind: DeviceKind): NetInterface {
  const seq = nextSeq(draft)
  const l3 = kind !== 'switch'
  // Serveurs et postes sont en DHCP par défaut, comme une installation neuve
  const isHost = kind === 'server' || kind === 'client'
  return {
    id: `if${seq}`,
    name,
    mac: macFromSeq(seq),
    enabled: true,
    l3,
    addressing: isHost ? 'dhcp' : 'static',
    address: null,
    prefixLength: null,
    gateway: null,
    dnsMode: isHost ? 'dhcp' : 'static',
    dnsServers: [],
    dhcpLease: null,
    dhcpReleased: false
  }
}

/** Noms des interfaces par défaut selon le type d'équipement. */
export function defaultInterfaceNames(kind: DeviceKind): string[] {
  switch (kind) {
    case 'server':
    case 'client':
      return ['Ethernet0']
    case 'switch':
      return Array.from({ length: SWITCH_PORT_COUNT }, (_, i) => `Port ${i + 1}`)
    case 'router':
      return Array.from({ length: ROUTER_INTERFACE_COUNT }, (_, i) => `Eth${i}`)
    case 'cloud':
      return ['WAN']
  }
}

/** Premier nom libre de la forme PREFIXEn (SRV1, SRV2…). Comparaison insensible à la casse. */
export function nextDeviceName(state: LabState | Draft<LabState>, kind: DeviceKind): string {
  const used = new Set(Object.values(state.devices).map((d) => d.name.toUpperCase()))
  const prefix = DEVICE_KIND_INFO[kind].namePrefix
  for (let n = 1; ; n++) {
    const candidate = `${prefix}${n}`
    if (!used.has(candidate)) return candidate
  }
}

/** Construit un équipement complet (sans l'ajouter à l'état). */
export function buildDevice(
  draft: Draft<LabState>,
  kind: DeviceKind,
  position: Position,
  name?: string
): Device {
  const id = `d${nextSeq(draft)}`
  const deviceName = name ?? nextDeviceName(draft, kind)
  const interfaces = defaultInterfaceNames(kind).map((n) => createInterface(draft, n, kind))
  const base = { id, name: deviceName, position: { ...position }, powered: true, interfaces }
  switch (kind) {
    case 'server':
      return { ...base, kind, host: createHost('server') }
    case 'client':
      return { ...base, kind, host: createHost('client') }
    case 'switch':
      return { ...base, kind }
    case 'router':
      return { ...base, kind, routes: [] }
    case 'cloud':
      return { ...base, kind }
  }
}
