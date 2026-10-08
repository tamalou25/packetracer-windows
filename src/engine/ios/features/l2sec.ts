/**
 * Sécurité de niveau 2 des switchs IOS : DHCP snooping (ip dhcp snooping, vlan, trust), inspection
 * ARP dynamique (ip arp inspection vlan, trust) et désactivation du DTP (switchport nonegotiate).
 * Les trames refusées le sont dans le moteur de couche 2 (crochet `inspect`), visibles en Simulation.
 */
import type { IosState, NetInterface } from '../../model/schema'
import { switchportOf } from '../../net/switchport'
import { formatVlanList, parseVlanList, vlanList } from '../cli/args'
import type { ArgContext, CliCommand, IosRunContext, SyntaxToken } from '../cli/types'
import { draftIfaceEntry, draftIosState, iosState } from '../config'
import { isIos, type IosDevice } from '../device'
import { defineIosFeature, type L2Frame } from '../feature'
import type { ConfigBlock } from '../running-config'
import { currentIfaces, deviceOf, update } from './base'

const kw = (keyword: string, help: string): SyntaxToken => ({ keyword, help })

const isSwitch = (ctx: ArgContext): boolean => ctx.state.devices[ctx.deviceId]?.kind === 'switch'
/** Ports physiques de switch (pas une interface VLAN). */
const switchPorts = (ctx: ArgContext): boolean =>
  isSwitch(ctx) && currentIfaces(ctx).every((i) => !i.svi && !i.l3)

type IfaceEntry = IosState['interfaces'][string]

const entryOf = (device: IosDevice, port: NetInterface): IfaceEntry | undefined =>
  iosState(device).interfaces[port.name]

/** VLAN surveillés par le DHCP snooping (fonction active globalement et sur le VLAN). */
export function snoopingActive(device: IosDevice, vlan: number): boolean {
  const ios = iosState(device)
  return ios.dhcpSnooping && ios.dhcpSnoopingVlans.includes(vlan)
}

// ---------------------------------------------------------------------------
// Modifications
// ---------------------------------------------------------------------------

function setVlans(
  ctx: IosRunContext,
  key: 'dhcpSnoopingVlans' | 'arpInspectionVlans',
  list: string | undefined,
  add: boolean
): void {
  const ids = parseVlanList(list ?? '') ?? []
  update(ctx, (d) => {
    const ios = draftIosState(d)
    const current = new Set(ios[key])
    for (const id of ids) {
      if (add) current.add(id)
      else current.delete(id)
    }
    ios[key] = [...current].sort((a, b) => a - b)
  })
}

function setPortFlag(
  ctx: IosRunContext,
  flag: 'dhcpSnoopingTrust' | 'arpInspectionTrust' | 'nonegotiate',
  value: boolean
): void {
  const ports = currentIfaces(ctx)
  update(ctx, (d) => {
    const ios = draftIosState(d)
    for (const p of ports) draftIfaceEntry(ios, p.name)[flag] = value
  })
}

// ---------------------------------------------------------------------------
// Affichage
// ---------------------------------------------------------------------------

function showDhcpSnooping(ctx: IosRunContext): void {
  const device = deviceOf(ctx)
  const ios = iosState(device)
  ctx.print(`Switch DHCP snooping is ${ios.dhcpSnooping ? 'enabled' : 'disabled'}`)
  ctx.print('DHCP snooping is configured on following VLANs:')
  ctx.print(formatVlanList(ios.dhcpSnoopingVlans) || 'none')
  ctx.print('DHCP snooping is operational on following VLANs:')
  const operational = ios.dhcpSnooping
    ? ios.dhcpSnoopingVlans.filter((id) => device.kind === 'switch' && device.vlans.some((v) => v.id === id))
    : []
  ctx.print(formatVlanList(operational) || 'none')
  ctx.print('Insertion of option 82 is disabled')
  ctx.print('Interface                  Trusted    Allow option    Rate limit (pps)')
  ctx.print('-----------------------    -------    ------------    ----------------')
  for (const port of device.interfaces)
    if (entryOf(device, port)?.dhcpSnoopingTrust)
      ctx.print(`${port.name.padEnd(27)}${'yes'.padEnd(11)}${'yes'.padEnd(16)}unlimited`)
}

function showArpInspection(ctx: IosRunContext): void {
  const device = deviceOf(ctx)
  const ios = iosState(device)
  ctx.print('')
  ctx.print(' Vlan     Configuration    Operation   ACL Match          Static ACL')
  ctx.print(' ----     -------------    ---------   ---------          ----------')
  for (const id of ios.arpInspectionVlans) {
    const active = device.kind === 'switch' && device.vlans.some((v) => v.id === id)
    ctx.print(` ${String(id).padEnd(9)}${'Enabled'.padEnd(17)}${active ? 'Active' : 'Inactive'}`)
  }
  ctx.print('')
  ctx.print(' Interface        Trust State     Rate (pps)    Burst Interval')
  ctx.print(' ---------------  -----------     ----------    --------------')
  for (const port of device.interfaces) {
    if (port.svi || port.l3) continue
    const trusted = !!entryOf(device, port)?.arpInspectionTrust
    ctx.print(
      ` ${port.name.padEnd(17)}${(trusted ? 'Trusted' : 'Untrusted').padEnd(16)}${(trusted ? 'None' : '15').padEnd(14)}${trusted ? 'N/A' : '1'}`
    )
  }
}

// ---------------------------------------------------------------------------
// Commandes
// ---------------------------------------------------------------------------

const IP = kw('ip', 'Global IP configuration subcommands')
const IP_IF = kw('ip', 'Interface Internet Protocol config commands')
const DHCP = kw('dhcp', 'Configure DHCP server and relay parameters')
const SNOOPING = kw('snooping', 'DHCP Snooping')
const ARP = kw('arp', 'Set ARP inspection parameters')
const INSPECTION = kw('inspection', 'Arp Inspection configuration')
const VLAN = kw('vlan', 'DHCP Snooping vlan')
const LIST = { arg: 'list', type: vlanList(), help: 'DHCP Snooping vlan first number or vlan range' }
const TRUST = kw('trust', 'DHCP Snooping trust config')

const commands: CliCommand[] = [
  {
    modes: ['config'],
    syntax: [IP, DHCP, SNOOPING],
    available: isSwitch,
    run: (ctx) =>
      update(ctx, (d) => {
        draftIosState(d).dhcpSnooping = true
      }),
    no: {
      run: (ctx) =>
        update(ctx, (d) => {
          draftIosState(d).dhcpSnooping = false
        })
    }
  },
  {
    modes: ['config'],
    syntax: [IP, DHCP, SNOOPING, VLAN, LIST],
    available: isSwitch,
    run: (ctx, args) => setVlans(ctx, 'dhcpSnoopingVlans', args.list, true),
    no: { run: (ctx, args) => setVlans(ctx, 'dhcpSnoopingVlans', args.list, false) }
  },
  {
    modes: ['config'],
    syntax: [IP, ARP, INSPECTION, kw('vlan', 'Enable/Disable ARP Inspection on vlans'), LIST],
    available: isSwitch,
    run: (ctx, args) => setVlans(ctx, 'arpInspectionVlans', args.list, true),
    no: { run: (ctx, args) => setVlans(ctx, 'arpInspectionVlans', args.list, false) }
  },
  {
    modes: ['config-if'],
    syntax: [IP_IF, DHCP, SNOOPING, TRUST],
    available: switchPorts,
    run: (ctx) => setPortFlag(ctx, 'dhcpSnoopingTrust', true),
    no: { run: (ctx) => setPortFlag(ctx, 'dhcpSnoopingTrust', false) }
  },
  {
    modes: ['config-if'],
    syntax: [IP_IF, ARP, INSPECTION, kw('trust', 'Configure Trust state')],
    available: switchPorts,
    run: (ctx) => setPortFlag(ctx, 'arpInspectionTrust', true),
    no: { run: (ctx) => setPortFlag(ctx, 'arpInspectionTrust', false) }
  },
  {
    modes: ['config-if'],
    syntax: [
      kw('switchport', 'Set switching mode characteristics'),
      kw('nonegotiate', 'Device will not engage in negotiation protocol on this interface')
    ],
    available: switchPorts,
    run: (ctx) => setPortFlag(ctx, 'nonegotiate', true),
    no: { run: (ctx) => setPortFlag(ctx, 'nonegotiate', false) }
  },
  {
    modes: ['user', 'exec'],
    syntax: [kw('show', 'Show running system information'), kw('ip', 'IP information'), DHCP, SNOOPING],
    available: isSwitch,
    run: showDhcpSnooping
  },
  {
    modes: ['user', 'exec'],
    syntax: [
      kw('show', 'Show running system information'),
      kw('ip', 'IP information'),
      ARP,
      kw('inspection', 'Show ARP Inspection information')
    ],
    available: isSwitch,
    run: showArpInspection
  }
]

// ---------------------------------------------------------------------------
// Running-config
// ---------------------------------------------------------------------------

function config(device: IosDevice): ConfigBlock[] {
  if (device.kind !== 'switch') return []
  const ios = iosState(device)
  const lines: string[] = []
  if (ios.dhcpSnoopingVlans.length)
    lines.push(`ip dhcp snooping vlan ${formatVlanList(ios.dhcpSnoopingVlans)}`)
  if (ios.dhcpSnooping) lines.push('ip dhcp snooping')
  if (ios.arpInspectionVlans.length)
    lines.push(`ip arp inspection vlan ${formatVlanList(ios.arpInspectionVlans)}`)
  return lines.length ? [{ order: 46, lines }] : []
}

function interfaceConfig(device: IosDevice, port: NetInterface): ConfigBlock[] {
  const entry = entryOf(device, port)
  if (device.kind !== 'switch' || !entry) return []
  const blocks: ConfigBlock[] = []
  if (entry.nonegotiate) blocks.push({ order: 21, lines: ['switchport nonegotiate'] })
  const trust: string[] = []
  if (entry.arpInspectionTrust) trust.push('ip arp inspection trust')
  if (entry.dhcpSnoopingTrust) trust.push('ip dhcp snooping trust')
  if (trust.length) blocks.push({ order: 70, lines: trust })
  return blocks
}

// ---------------------------------------------------------------------------
// Inspection des trames
// ---------------------------------------------------------------------------

/**
 * Trame reçue sur un port du switch, dans le VLAN `vlan` : explication du refus, ou null si elle
 * passe. DHCP snooping : réponses de serveur DHCP refusées sur un port non fiable. Inspection ARP :
 * ARP refusé sur un port non fiable si le couple IP / MAC n'est pas un bail DHCP (base du snooping).
 */
function inspect(device: IosDevice, port: NetInterface, vlan: number, frame: L2Frame): string | null {
  if (device.kind !== 'switch') return null
  const entry = entryOf(device, port)
  const ios = iosState(device)
  if (frame.kind === 'dhcp-server') {
    if (!snoopingActive(device, vlan) || entry?.dhcpSnoopingTrust) return null
    return `${device.name} (DHCP snooping, VLAN ${vlan}) : ${port.name} n’est pas un port de confiance, la réponse de ce serveur DHCP est rejetée.`
  }
  if (!ios.arpInspectionVlans.includes(vlan) || entry?.arpInspectionTrust) return null
  if (frame.leased && snoopingActive(device, vlan)) return null
  return `${device.name} (inspection ARP, VLAN ${vlan}) : ${frame.ip} / ${frame.mac} reçu sur ${port.name} ne figure pas dans la base du DHCP snooping, le paquet ARP est rejeté.`
}

/** Le port négocie-t-il un trunk (DTP actif : trunk sans switchport nonegotiate) ? */
export function dtpActive(device: IosDevice, port: NetInterface): boolean {
  return (
    device.kind === 'switch' &&
    !port.svi &&
    !port.l3 &&
    switchportOf(port).mode === 'trunk' &&
    !entryOf(device, port)?.nonegotiate
  )
}

export const l2sec = defineIosFeature({
  id: 'l2sec',
  commands,
  config,
  interfaceConfig,
  inspect: (_state, device, port, vlan, frame) => (isIos(device) ? inspect(device, port, vlan, frame) : null)
})
