/**
 * Hyper-V : commutateurs virtuels (externe, interne, privé) et machines virtuelles.
 *
 * Une machine virtuelle est un serveur ou un poste du lab hébergé par l'hôte (`hostedBy`) ;
 * un commutateur virtuel est un switch hébergé dont les ports sont créés à la demande et reliés
 * par des liaisons virtuelles. Commutateur externe : la carte physique de l'hôte devient un pont
 * (`bridge`) et sa configuration IP passe sur la carte vEthernet de l'hôte.
 */
import type { Draft } from 'immer'
import { raise, transact, type EngineResult } from '../../core/result'
import { buildDevice, createInterface, nextSeq } from '../../model/factory'
import type { Device, LabState, NetInterface, ServerDevice } from '../../model/schema'
import { deviceNameError, requireDevice, setPower } from '../../topology/actions'
import { ensureRoleState } from '../state'
import type { HyperVServer, VirtualMachine, VirtualSwitch, VSwitchType } from './schema'
import { HYPERV_STATE } from './state'

/** Cartes réseau synthétiques au plus par machine virtuelle. */
export const VM_MAX_ADAPTERS = 8

export function requireHyperV(
  draft: Draft<LabState>,
  hostId: string
): { host: Draft<ServerDevice>; hv: Draft<HyperVServer> } {
  const host = requireDevice(draft, hostId)
  if (host.kind !== 'server' || !host.host.features.includes('Hyper-V'))
    raise('HyperVNotInstalled', 'Le rôle Hyper-V n’est pas installé sur cet ordinateur.')
  return { host, hv: ensureRoleState(host, HYPERV_STATE) }
}

export function findSwitch<T extends VirtualSwitch>(switches: T[], name: string): T {
  const sw = switches.find((s) => s.name.toLowerCase() === name.trim().toLowerCase())
  if (!sw) raise('SwitchNotFound', `Le commutateur virtuel « ${name} » est introuvable.`)
  return sw
}

/** Machine virtuelle de l'hôte désignée par son nom. */
export function findVm(
  draft: Draft<LabState>,
  hv: Draft<HyperVServer>,
  name: string
): { vm: Draft<VirtualMachine>; device: Draft<Device> } {
  const lower = name.trim().toLowerCase()
  for (const vm of hv.vms) {
    const device = draft.devices[vm.deviceId]
    if (device && device.name.toLowerCase() === lower) return { vm, device }
  }
  raise('VmNotFound', `Hyper-V n’a pas trouvé de machine virtuelle nommée « ${name} ».`)
}

/** Position libre près de l'hôte sur le canvas (sous l'hôte, de gauche à droite). */
function nearHost(draft: Draft<LabState>, host: Draft<ServerDevice>, row: number): { x: number; y: number } {
  const count = Object.values(draft.devices).filter((d) => d.hostedBy === host.id).length
  return { x: host.position.x - 120 + (count % 4) * 110, y: host.position.y + 140 * row }
}

/** Nouveau port du commutateur virtuel, relié par une liaison virtuelle à la carte donnée. */
function plug(draft: Draft<LabState>, switchId: string, end: { deviceId: string; ifaceId: string }): void {
  const sw = requireDevice(draft, switchId)
  const port = createInterface(draft, `Port${sw.interfaces.length + 1}`, 'switch')
  sw.interfaces.push(port)
  const id = `l${nextSeq(draft)}`
  draft.links[id] = { id, a: { deviceId: switchId, ifaceId: port.id }, b: { ...end }, virtual: true }
}

/** Débranche une carte de son commutateur virtuel (liaison et port supprimés). */
function unplug(draft: Draft<LabState>, end: { deviceId: string; ifaceId: string }): void {
  for (const link of Object.values(draft.links)) {
    if (!link.virtual) continue
    const mine =
      link.a.deviceId === end.deviceId && link.a.ifaceId === end.ifaceId
        ? link.b
        : link.b.deviceId === end.deviceId && link.b.ifaceId === end.ifaceId
          ? link.a
          : null
    if (!mine) continue
    delete draft.links[link.id]
    const sw = draft.devices[mine.deviceId]
    if (sw) sw.interfaces = sw.interfaces.filter((i) => i.id !== mine.ifaceId)
  }
}

/** Commutateur virtuel auquel une carte est reliée (nom), sinon null. */
export function switchOfAdapter(
  state: LabState,
  hv: HyperVServer,
  deviceId: string,
  ifaceId: string
): VirtualSwitch | null {
  const link = Object.values(state.links).find(
    (l) =>
      l.virtual &&
      ((l.a.deviceId === deviceId && l.a.ifaceId === ifaceId) ||
        (l.b.deviceId === deviceId && l.b.ifaceId === ifaceId))
  )
  if (!link) return null
  const other = link.a.deviceId === deviceId ? link.b : link.a
  return hv.switches.find((s) => s.deviceId === other.deviceId) ?? null
}

/** Copie la configuration IP d'une carte (sans identité matérielle ni bail). */
function copyIp(from: Draft<NetInterface>, to: Draft<NetInterface>): void {
  to.addressing = from.addressing
  to.address = from.address
  to.prefixLength = from.prefixLength
  to.gateway = from.gateway
  to.dnsMode = from.dnsMode
  to.dnsServers = [...from.dnsServers]
  to.dhcpLease = null
  to.dhcpReleased = false
}

function clearIp(iface: Draft<NetInterface>): void {
  iface.addressing = 'static'
  iface.address = null
  iface.prefixLength = null
  iface.gateway = null
  iface.dnsMode = 'static'
  iface.dnsServers = []
  iface.dhcpLease = null
  iface.dhcpReleased = false
}

export interface SwitchInput {
  name: string
  type: VSwitchType
  /** Commutateur externe : nom de la carte physique de l'hôte (Ethernet0). */
  netAdapter?: string
  /** Commutateur externe : autoriser le système d'exploitation de gestion à partager la carte. */
  allowManagementOS?: boolean
}

/** Crée un commutateur virtuel ; renvoie l'identifiant de son équipement. */
export function newVMSwitch(state: LabState, hostId: string, input: SwitchInput): EngineResult<string> {
  return transact(state, (draft) => {
    const { host, hv } = requireHyperV(draft, hostId)
    const name = input.name.trim()
    if (!name) raise('InvalidName', 'Indiquez le nom du commutateur virtuel.')
    if (hv.switches.some((s) => s.name.toLowerCase() === name.toLowerCase()))
      raise('SwitchExists', `Un commutateur virtuel nommé « ${name} » existe déjà.`)
    let uplink: Draft<NetInterface> | undefined
    if (input.type === 'External') {
      const adapter = input.netAdapter?.trim() ?? ''
      uplink = host.interfaces.find((i) => i.name.toLowerCase() === adapter.toLowerCase())
      if (!adapter || !uplink || uplink.name.startsWith('vEthernet'))
        raise('AdapterNotFound', `La carte réseau physique « ${adapter} » est introuvable sur ${host.name}.`)
      if (uplink.bridge)
        raise(
          'AdapterInUse',
          `La carte réseau « ${uplink.name} » est déjà liée à un commutateur virtuel externe.`
        )
    }
    const sw = buildDevice(draft, 'switch', nearHost(draft, host, 1), `${name} (${host.name})`)
    sw.interfaces = []
    sw.hostedBy = host.id
    sw.powered = host.powered
    draft.devices[sw.id] = sw
    const record: VirtualSwitch = {
      deviceId: sw.id,
      name,
      type: input.type,
      netAdapter: null,
      hostAdapter: null
    }
    // Carte virtuelle de l'hôte : commutateur interne, ou externe partagé avec le système de gestion
    const management =
      input.type === 'Internal' || (input.type === 'External' && input.allowManagementOS !== false)
    if (management) {
      const vnic = createInterface(draft, `vEthernet (${name})`, 'server')
      if (uplink) copyIp(uplink, vnic)
      host.interfaces.push(vnic)
      plug(draft, sw.id, { deviceId: host.id, ifaceId: vnic.id })
      record.hostAdapter = vnic.id
    }
    if (uplink) {
      uplink.bridge = sw.id
      clearIp(uplink)
      record.netAdapter = uplink.id
    }
    hv.switches.push(record)
    return sw.id
  })
}

/** Supprime un commutateur virtuel : les cartes des VM sont déconnectées. */
export function removeVMSwitch(state: LabState, hostId: string, name: string): EngineResult {
  return transact(state, (draft) => {
    const { host, hv } = requireHyperV(draft, hostId)
    const record = findSwitch(hv.switches, name)
    for (const link of Object.values(draft.links))
      if (link.a.deviceId === record.deviceId || link.b.deviceId === record.deviceId)
        delete draft.links[link.id]
    const vnic = host.interfaces.find((i) => i.id === record.hostAdapter)
    const uplink = host.interfaces.find((i) => i.id === record.netAdapter)
    // Commutateur externe : la configuration IP revient sur la carte physique
    if (uplink) {
      uplink.bridge = null
      if (vnic) copyIp(vnic, uplink)
    }
    host.interfaces = host.interfaces.filter((i) => i.id !== record.hostAdapter)
    delete draft.devices[record.deviceId]
    hv.switches = hv.switches.filter((s) => s !== record)
    return undefined
  })
}

export interface VmInput {
  name: string
  /** Mémoire de démarrage (Mo). */
  memoryMB?: number
  generation?: 1 | 2
  /** Système invité simulé. */
  guest?: 'server' | 'client'
  /** Commutateur virtuel de la première carte réseau. */
  switchName?: string | null
}

/** Crée une machine virtuelle (arrêtée) ; renvoie l'identifiant de son équipement. */
export function newVM(state: LabState, hostId: string, input: VmInput): EngineResult<string> {
  return transact(state, (draft) => {
    const { host, hv } = requireHyperV(draft, hostId)
    const name = input.name.trim()
    const guest = input.guest ?? 'server'
    const err = deviceNameError(guest, name)
    if (err) raise('InvalidName', `Nom de machine virtuelle non valide : ${err}`)
    if (Object.values(draft.devices).some((d) => d.name.toUpperCase() === name.toUpperCase()))
      raise('DuplicateName', `Un équipement nommé « ${name} » existe déjà dans la topologie.`)
    const memoryMB = input.memoryMB ?? 1024
    if (!Number.isInteger(memoryMB) || memoryMB < 32)
      raise('InvalidMemory', 'La mémoire de démarrage doit être d’au moins 32 Mo.')
    const vm = buildDevice(draft, guest, nearHost(draft, host, 2), name)
    vm.hostedBy = host.id
    vm.powered = false
    // Adresse MAC dynamique attribuée par Hyper-V (préfixe 00-15-5D)
    for (const iface of vm.interfaces) iface.mac = `00-15-5D${iface.mac.slice(8)}`
    draft.devices[vm.id] = vm
    hv.vms.push({ deviceId: vm.id, generation: input.generation ?? 1, memoryMB })
    if (input.switchName) {
      const sw = findSwitch(hv.switches, input.switchName)
      const nic = vm.interfaces[0]
      if (nic) plug(draft, sw.deviceId, { deviceId: vm.id, ifaceId: nic.id })
    }
    return vm.id
  })
}

/** Supprime une machine virtuelle arrêtée. */
export function removeVM(state: LabState, hostId: string, name: string): EngineResult {
  return transact(state, (draft) => {
    const { hv } = requireHyperV(draft, hostId)
    const { vm, device } = findVm(draft, hv, name)
    if (device.powered)
      raise(
        'VmRunning',
        `La machine virtuelle « ${device.name} » est en cours d’exécution : arrêtez-la d’abord.`
      )
    for (const iface of device.interfaces) unplug(draft, { deviceId: device.id, ifaceId: iface.id })
    delete draft.devices[device.id]
    hv.vms = hv.vms.filter((v) => v !== vm)
    return undefined
  })
}

/** Démarre ou arrête une machine virtuelle (arrêt du système invité). */
export function setVMState(state: LabState, hostId: string, name: string, running: boolean): EngineResult {
  const found = transact(state, (draft) => {
    const { host, hv } = requireHyperV(draft, hostId)
    const { device } = findVm(draft, hv, name)
    if (running && !host.powered) raise('HostPoweredOff', `L’hôte ${host.name} est éteint.`)
    return device.id
  })
  return found.ok ? setPower(state, found.value, running) : found
}

/**
 * Relie une carte de VM à un commutateur (null : déconnectée). `adapter` : indice de la carte
 * (0 par défaut).
 */
export function connectVMNetworkAdapter(
  state: LabState,
  hostId: string,
  vmName: string,
  switchName: string | null,
  adapter = 0
): EngineResult {
  return transact(state, (draft) => {
    const { hv } = requireHyperV(draft, hostId)
    const { device } = findVm(draft, hv, vmName)
    const nic = device.interfaces[adapter]
    if (!nic) raise('AdapterNotFound', `La machine virtuelle « ${device.name} » n’a pas de carte réseau.`)
    const target = switchName ? findSwitch(hv.switches, switchName) : null
    unplug(draft, { deviceId: device.id, ifaceId: nic.id })
    if (target) plug(draft, target.deviceId, { deviceId: device.id, ifaceId: nic.id })
    return undefined
  })
}

/** Ajoute une carte réseau à une machine virtuelle arrêtée. */
export function addVMNetworkAdapter(
  state: LabState,
  hostId: string,
  vmName: string,
  switchName: string | null
): EngineResult<string> {
  return transact(state, (draft) => {
    const { hv } = requireHyperV(draft, hostId)
    const { device } = findVm(draft, hv, vmName)
    if (device.powered)
      raise('VmRunning', `Arrêtez la machine virtuelle « ${device.name} » avant d’ajouter une carte réseau.`)
    if (device.interfaces.length >= VM_MAX_ADAPTERS)
      raise(
        'LimitReached',
        `Une machine virtuelle ne peut pas avoir plus de ${VM_MAX_ADAPTERS} cartes réseau.`
      )
    const target = switchName ? findSwitch(hv.switches, switchName) : null
    const nic = createInterface(draft, `Ethernet${device.interfaces.length}`, device.kind)
    nic.mac = `00-15-5D${nic.mac.slice(8)}`
    device.interfaces.push(nic)
    if (target) plug(draft, target.deviceId, { deviceId: device.id, ifaceId: nic.id })
    return nic.id
  })
}

/** Mémoire de démarrage d'une machine virtuelle arrêtée (Set-VM -MemoryStartupBytes). */
export function setVMMemory(state: LabState, hostId: string, vmName: string, memoryMB: number): EngineResult {
  return transact(state, (draft) => {
    const { hv } = requireHyperV(draft, hostId)
    const { vm, device } = findVm(draft, hv, vmName)
    if (device.powered)
      raise(
        'VmRunning',
        `Arrêtez la machine virtuelle « ${device.name} » pour modifier sa mémoire de démarrage.`
      )
    if (!Number.isInteger(memoryMB) || memoryMB < 32)
      raise('InvalidMemory', 'La mémoire de démarrage doit être d’au moins 32 Mo.')
    vm.memoryMB = memoryMB
    return undefined
  })
}
