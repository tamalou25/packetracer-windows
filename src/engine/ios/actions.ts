/**
 * Actions du moteur propres aux équipements IOS (fonctions pures, immer).
 */
import { raise, transact, type EngineResult } from '../core/result'
import { nextSeq } from '../model/factory'
import type { LabState, NetInterface } from '../model/schema'
import { isIos } from './device'

/**
 * Crée la sous-interface `name` (Gi0/0.10) d'un routeur IOS, sans encapsulation : comme sur IOS,
 * elle n'achemine rien tant que `encapsulation dot1Q` n'est pas configuré. Renvoie son identifiant.
 */
export function createSubinterface(
  state: LabState,
  deviceId: string,
  parentId: string,
  name: string
): EngineResult<string> {
  return transact(state, (draft) => {
    const router = draft.devices[deviceId]
    if (!router || router.kind !== 'router' || !isIos(router)) raise('NotARouter', 'Routeur IOS introuvable.')
    const parent = router.interfaces.find((i) => i.id === parentId && !i.subinterface)
    if (!parent) raise('InterfaceNotFound', 'Interface physique introuvable.')
    if (router.interfaces.some((i) => i.name === name))
      raise('Duplicate', `La sous-interface ${name} existe déjà.`)
    const id = `if${nextSeq(draft)}`
    const sub: NetInterface = {
      id,
      name,
      mac: parent.mac,
      enabled: true,
      l3: true,
      addressing: 'static',
      address: null,
      prefixLength: null,
      gateway: null,
      dnsMode: 'static',
      dnsServers: [],
      dhcpLease: null,
      dhcpReleased: false,
      bridge: null,
      subinterface: { parent: parentId, vlan: null }
    }
    // Après la carte parente et ses sous-interfaces existantes
    let at = router.interfaces.findIndex((i) => i.id === parentId) + 1
    while (router.interfaces[at]?.subinterface?.parent === parentId) at++
    router.interfaces.splice(at, 0, sub)
    return id
  })
}

/** Supprime une sous-interface par son nom (no interface Gi0/0.10) et ses câbles logiques. */
export function removeSubinterfaceByName(state: LabState, deviceId: string, name: string): EngineResult {
  return transact(state, (draft) => {
    const device = draft.devices[deviceId]
    const index = device?.interfaces.findIndex((i) => i.name === name && i.subinterface) ?? -1
    if (!device || index < 0) raise('InterfaceNotFound', 'Sous-interface introuvable.')
    device.interfaces.splice(index, 1)
    return undefined
  })
}
