/**
 * Aides pour les tests du moteur.
 */
import { addDevice, connect, createLab, unwrap, type DeviceKind, type LabState } from '@engine/index'

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
