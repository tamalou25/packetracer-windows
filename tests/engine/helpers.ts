/**
 * Aides pour les tests du moteur.
 */
import {
  addDevice,
  connect,
  createLab,
  setInterfaceIpv4,
  unwrap,
  type DeviceKind,
  type LabState
} from '@engine/index'

/** Ajoute un équipement et renvoie le nouvel état et son identifiant. */
export function add(state: LabState, kind: DeviceKind, name?: string): { state: LabState; id: string } {
  const r = unwrap(addDevice(state, { kind, position: { x: 0, y: 0 }, ...(name ? { name } : {}) }))
  return { state: r.state, id: r.value }
}

/** Relie le port n°ia de A au port n°ib de B. */
export function cable(state: LabState, a: string, ia: number, b: string, ib: number): LabState {
  const da = state.devices[a]
  const db = state.devices[b]
  if (!da || !db) throw new Error('équipement absent')
  const ifa = da.interfaces[ia]
  const ifb = db.interfaces[ib]
  if (!ifa || !ifb) throw new Error('port absent')
  return unwrap(connect(state, { deviceId: a, ifaceId: ifa.id }, { deviceId: b, ifaceId: ifb.id })).state
}

export { createLab }

/** Configure une carte en statique : ip('192.168.1.10/24', '192.168.1.254'). */
export function setIp(
  state: LabState,
  deviceId: string,
  ifaceIndex: number,
  cidr: string,
  gateway?: string,
  dns?: string[]
): LabState {
  const device = state.devices[deviceId]
  const iface = device?.interfaces[ifaceIndex]
  if (!device || !iface) throw new Error('carte absente')
  const [address, prefix] = cidr.split('/')
  return unwrap(
    setInterfaceIpv4(state, deviceId, iface.id, {
      addressing: 'static',
      address: address ?? '',
      mask: prefix ?? '24',
      gateway: gateway ?? null,
      dnsServers: dns ?? []
    })
  ).state
}

/** Construit une suite d'ajouts : renvoie l'état et les identifiants par nom. */
export function build(kinds: [DeviceKind, string][]): { state: LabState; ids: Record<string, string> } {
  let state = createLab()
  const ids: Record<string, string> = {}
  for (const [kind, name] of kinds) {
    const r = add(state, kind, name)
    state = r.state
    ids[name] = r.id
  }
  return { state, ids }
}
