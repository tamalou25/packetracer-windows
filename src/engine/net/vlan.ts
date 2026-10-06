/**
 * VLAN 802.1Q : base des VLAN d'un switch, ports d'accès et trunks, sous-interfaces de routeur
 * (routeur « on a stick » : Gi0/0.10, encapsulation dot1Q 10).
 */
import type { Draft } from 'immer'
import { raise, transact, type EngineResult } from '../core/result'
import { nextSeq } from '../model/factory'
import type { LabState, NetInterface, RouterDevice, SwitchDevice, Switchport } from '../model/schema'
import { requireDevice } from '../topology/actions'
import { defaultVlanName, switchportOf } from './switchport'

export * from './switchport'

/** VLAN réservés (1002 à 1005 : héritage FDDI et Token Ring). */
const RESERVED = [1002, 1003, 1004, 1005]

function checkVlanId(id: number): void {
  if (!Number.isInteger(id) || id < 1 || id > 4094)
    raise('InvalidVlan', `Le numéro de VLAN « ${id} » n’est pas valide (1 à 4094).`)
  if (RESERVED.includes(id))
    raise('InvalidVlan', `Le VLAN ${id} est réservé (1002 à 1005) et ne peut pas être utilisé.`)
}

function requireSwitch(draft: Draft<LabState>, deviceId: string): Draft<SwitchDevice> {
  const device = requireDevice(draft, deviceId)
  if (device.kind !== 'switch' || device.hostedBy)
    raise('NotSupported', 'Les VLAN se configurent sur un switch physique.')
  return device
}

function requireRouter(draft: Draft<LabState>, deviceId: string): Draft<RouterDevice> {
  const device = requireDevice(draft, deviceId)
  if (device.kind !== 'router') raise('NotSupported', 'Les sous-interfaces se créent sur un routeur.')
  return device
}

/** Crée un VLAN dans la base du switch (nom par défaut VLAN00NN). */
export function addVlan(state: LabState, deviceId: string, id: number, name?: string): EngineResult {
  return transact(state, (draft) => {
    const sw = requireSwitch(draft, deviceId)
    checkVlanId(id)
    if (sw.vlans.some((v) => v.id === id)) raise('VlanExists', `Le VLAN ${id} existe déjà sur ${sw.name}.`)
    const label = (name ?? '').trim() || defaultVlanName(id)
    if (/\s/.test(label)) raise('InvalidName', 'Le nom d’un VLAN ne contient pas d’espace.')
    sw.vlans.push({ id, name: label })
    sw.vlans.sort((a, b) => a.id - b.id)
    return undefined
  })
}

/** Renomme un VLAN (le VLAN 1 garde le nom « default »). */
export function renameVlan(state: LabState, deviceId: string, id: number, name: string): EngineResult {
  return transact(state, (draft) => {
    const sw = requireSwitch(draft, deviceId)
    const vlan = sw.vlans.find((v) => v.id === id)
    if (!vlan) raise('VlanNotFound', `Le VLAN ${id} n’existe pas sur ${sw.name}.`)
    if (id === 1) raise('DefaultVlan', 'Le nom du VLAN 1 par défaut ne peut pas être modifié.')
    const label = name.trim()
    if (!label || /\s/.test(label)) raise('InvalidName', 'Le nom d’un VLAN est obligatoire et sans espace.')
    vlan.name = label
    return undefined
  })
}

/**
 * Supprime un VLAN de la base. Les ports qui lui sont affectés restent configurés mais ne
 * transmettent plus (port inactif) jusqu'à la recréation du VLAN.
 */
export function removeVlan(state: LabState, deviceId: string, id: number): EngineResult {
  return transact(state, (draft) => {
    const sw = requireSwitch(draft, deviceId)
    if (id === 1) raise('DefaultVlan', 'Le VLAN 1 par défaut ne peut pas être supprimé.')
    const index = sw.vlans.findIndex((v) => v.id === id)
    if (index < 0) raise('VlanNotFound', `Le VLAN ${id} n’existe pas sur ${sw.name}.`)
    sw.vlans.splice(index, 1)
    return undefined
  })
}

export interface SwitchportInput {
  mode: 'access' | 'trunk'
  accessVlan?: number
  nativeVlan?: number
  /** VLAN autorisés sur le trunk (null : tous). */
  allowedVlans?: number[] | null
}

/**
 * Configure un port de switch en accès ou en trunk 802.1Q. Affecter un port d'accès à un VLAN
 * absent de la base le crée, comme `switchport access vlan` sur un switch.
 */
export function setSwitchport(
  state: LabState,
  deviceId: string,
  ifaceId: string,
  input: SwitchportInput
): EngineResult {
  return transact(state, (draft) => {
    const sw = requireSwitch(draft, deviceId)
    const port = sw.interfaces.find((i) => i.id === ifaceId)
    if (!port) raise('InterfaceNotFound', `Port introuvable sur ${sw.name}.`)
    const current = switchportOf(port as NetInterface)
    const accessVlan = input.accessVlan ?? current.accessVlan
    const nativeVlan = input.nativeVlan ?? current.nativeVlan
    const allowed = input.allowedVlans === undefined ? current.allowedVlans : input.allowedVlans
    for (const id of [accessVlan, nativeVlan, ...(allowed ?? [])]) checkVlanId(id)
    if (allowed && allowed.length === 0)
      raise('InvalidVlan', 'Un trunk doit autoriser au moins un VLAN (laissez vide pour tous).')
    if (input.mode === 'access' && !sw.vlans.some((v) => v.id === accessVlan)) {
      sw.vlans.push({ id: accessVlan, name: defaultVlanName(accessVlan) })
      sw.vlans.sort((a, b) => a.id - b.id)
    }
    const config: Switchport = {
      mode: input.mode,
      accessVlan,
      nativeVlan,
      allowedVlans: allowed ? [...new Set(allowed)].sort((a, b) => a - b) : null
    }
    const isDefault =
      config.mode === 'access' &&
      config.accessVlan === 1 &&
      config.nativeVlan === 1 &&
      config.allowedVlans === null
    if (isDefault) delete port.switchport
    else port.switchport = config
    return undefined
  })
}

/**
 * Crée la sous-interface `<carte>.<vlan>` d'un routeur, encapsulation dot1Q sur ce VLAN.
 * Elle partage l'adresse MAC et le câble de sa carte parente. Renvoie son identifiant.
 */
export function addSubinterface(
  state: LabState,
  deviceId: string,
  parentId: string,
  vlan: number
): EngineResult<string> {
  return transact(state, (draft) => {
    const router = requireRouter(draft, deviceId)
    const parent = router.interfaces.find((i) => i.id === parentId)
    if (!parent || parent.subinterface) raise('InterfaceNotFound', 'Interface physique introuvable.')
    checkVlanId(vlan)
    if (router.interfaces.some((i) => i.subinterface?.parent === parentId && i.subinterface.vlan === vlan))
      raise('VlanExists', `Une sous-interface de ${parent.name} utilise déjà le VLAN ${vlan}.`)
    const name = `${parent.name}.${vlan}`
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
      subinterface: { parent: parentId, vlan }
    }
    // Après la carte parente et ses sous-interfaces existantes
    let at = router.interfaces.findIndex((i) => i.id === parentId) + 1
    while (router.interfaces[at]?.subinterface?.parent === parentId) at++
    router.interfaces.splice(at, 0, sub)
    return id
  })
}

export function removeSubinterface(state: LabState, deviceId: string, ifaceId: string): EngineResult {
  return transact(state, (draft) => {
    const router = requireRouter(draft, deviceId)
    const index = router.interfaces.findIndex((i) => i.id === ifaceId && i.subinterface)
    if (index < 0) raise('InterfaceNotFound', 'Sous-interface introuvable.')
    router.interfaces.splice(index, 1)
    return undefined
  })
}
