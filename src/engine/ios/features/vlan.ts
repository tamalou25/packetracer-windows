/**
 * Switching et VLAN : base des VLAN (vlan, name), ports d'accès et trunks 802.1Q (switchport),
 * router-on-a-stick (encapsulation dot1Q sur une sous-interface), inter-VLAN de niveau 3 sur un
 * switch 9200 (ip routing, interface vlan). Sorties reprises d'IOS 15.
 */
import { raise } from '../../core/result'
import type { NetInterface, Switchport } from '../../model/schema'
import { DEFAULT_SWITCHPORT, defaultVlanName, switchportOf } from '../../net/switchport'
import { formatVlanList, number, parseVlanList, vlanList } from '../cli/args'
import type { ArgContext, CliCommand, IosRunContext, SyntaxToken } from '../cli/types'
import { draftIosState, iosState } from '../config'
import { isIos, type IosDevice } from '../device'
import { defineIosFeature } from '../feature'
import { ifaceLongName, IOS_MODEL_INFO } from '../models'
import type { ConfigBlock } from '../running-config'
import { ifaceStatus } from '../status'
import { currentIfaces, deviceOf, update } from './base'

const kw = (keyword: string, help: string): SyntaxToken => ({ keyword, help })

/** VLAN réservés (FDDI et Token Ring), présents sur tout switch. */
const RESERVED_VLANS: [number, string][] = [
  [1002, 'fddi-default'],
  [1003, 'token-ring-default'],
  [1004, 'fddinet-default'],
  [1005, 'trnet-default']
]

const isSwitch = (ctx: ArgContext): boolean => ctx.state.devices[ctx.deviceId]?.kind === 'switch'
const isLayer3Switch = (ctx: ArgContext): boolean => {
  const d = ctx.state.devices[ctx.deviceId]
  return d?.kind === 'switch' && isIos(d) && IOS_MODEL_INFO[d.model].layer3
}
/** Ports physiques de switch (pas une interface VLAN). */
const switchPorts = (ctx: ArgContext): boolean =>
  isSwitch(ctx) && currentIfaces(ctx).every((i) => !i.svi && !i.l3)
const subinterface = (ctx: ArgContext): boolean => currentIfaces(ctx).every((i) => !!i.subinterface)

// ---------------------------------------------------------------------------
// Base des VLAN
// ---------------------------------------------------------------------------

function enterVlans(ctx: IosRunContext, list: string): void {
  const ids = parseVlanList(list) ?? []
  if (ids.some((id) => id >= 1002 && id <= 1005)) {
    ctx.print(`%Default VLAN ${ids.find((id) => id >= 1002 && id <= 1005)} may not have its name changed.`)
    return
  }
  const ok = update(ctx, (d) => {
    if (d.kind !== 'switch') return
    for (const id of ids)
      if (!d.vlans.some((v) => v.id === id)) d.vlans.push({ id, name: defaultVlanName(id) })
    d.vlans.sort((a, b) => a.id - b.id)
  })
  if (ok) ctx.setMode('config-vlan', { vlans: ids })
}

function removeVlans(ctx: IosRunContext, list: string): void {
  const ids = parseVlanList(list) ?? []
  if (ids.includes(1)) {
    ctx.print('%Default VLAN 1 may not be deleted.')
    return
  }
  update(ctx, (d) => {
    if (d.kind === 'switch') d.vlans = d.vlans.filter((v) => !ids.includes(v.id))
  })
}

function setVlanName(ctx: IosRunContext, name: string | null): void {
  const ids = ctx.session.vlans ?? []
  update(ctx, (d) => {
    if (d.kind !== 'switch') return
    for (const v of d.vlans) if (ids.includes(v.id)) v.name = name ?? defaultVlanName(v.id)
  })
}

// ---------------------------------------------------------------------------
// Ports de switch
// ---------------------------------------------------------------------------

/** Modifie la configuration 802.1Q des ports en cours de configuration. */
function setPorts(ctx: IosRunContext, change: (port: Switchport) => Switchport): void {
  const ids = new Set(currentIfaces(ctx).map((i) => i.id))
  update(ctx, (d) => {
    for (const port of d.interfaces)
      if (ids.has(port.id)) port.switchport = change({ ...switchportOf(port as NetInterface) })
  })
}

function setAccessVlan(ctx: IosRunContext, vlan: number): void {
  const device = deviceOf(ctx)
  if (device.kind === 'switch' && !device.vlans.some((v) => v.id === vlan)) {
    ctx.print('% Access VLAN does not exist. Creating vlan ' + vlan)
    update(ctx, (d) => {
      if (d.kind !== 'switch') return
      d.vlans.push({ id: vlan, name: defaultVlanName(vlan) })
      d.vlans.sort((a, b) => a.id - b.id)
    })
  }
  setPorts(ctx, (p) => ({ ...p, accessVlan: vlan }))
}

/** switchport trunk allowed vlan [add | remove | except | all | none] LISTE */
function setAllowed(
  ctx: IosRunContext,
  action: 'set' | 'add' | 'remove' | 'except' | 'all' | 'none',
  list = ''
): void {
  const ids = parseVlanList(list) ?? []
  const all = Array.from({ length: 4094 }, (_, i) => i + 1)
  setPorts(ctx, (p) => {
    const current = p.allowedVlans ?? all
    let allowed: number[] | null
    switch (action) {
      case 'all':
        allowed = null
        break
      case 'none':
        allowed = []
        break
      case 'set':
        allowed = ids
        break
      case 'add':
        allowed = [...new Set([...current, ...ids])].sort((a, b) => a - b)
        break
      case 'remove':
        allowed = current.filter((id) => !ids.includes(id))
        break
      case 'except':
        allowed = all.filter((id) => !ids.includes(id))
        break
    }
    return { ...p, allowedVlans: allowed && allowed.length === 4094 ? null : allowed }
  })
}

// ---------------------------------------------------------------------------
// Sous-interfaces (router-on-a-stick)
// ---------------------------------------------------------------------------

function setEncapsulation(ctx: IosRunContext, vlan: number): void {
  const device = deviceOf(ctx)
  for (const sub of currentIfaces(ctx)) {
    const parent = sub.subinterface?.parent
    const other = device.interfaces.find(
      (i) => i.id !== sub.id && i.subinterface?.parent === parent && i.subinterface?.vlan === vlan
    )
    if (other) {
      ctx.print(
        `%Configuration of multiple subinterfaces of the same main interface with the same VID (${vlan}) is not permitted.`
      )
      ctx.print(`This VID is already configured on ${ifaceLongName(other.name)}.`)
      return
    }
    update(ctx, (d) => {
      const i = d.interfaces.find((x) => x.id === sub.id)
      if (!i?.subinterface) raise('InterfaceNotFound', 'Sous-interface introuvable.')
      i.subinterface.vlan = vlan
    })
  }
}

// ---------------------------------------------------------------------------
// show vlan brief, show interfaces trunk
// ---------------------------------------------------------------------------

/** Ports de la colonne IOS : quatre par ligne (« Fa0/1, Fa0/2, Fa0/3, Fa0/4 »). */
function portColumns(ports: string[]): string[] {
  const lines: string[] = []
  for (let i = 0; i < ports.length; i += 4) lines.push(ports.slice(i, i + 4).join(', '))
  return lines.length > 0 ? lines : ['']
}

function showVlanBrief(ctx: IosRunContext): void {
  const device = deviceOf(ctx)
  if (device.kind !== 'switch') return
  ctx.print('')
  ctx.print('VLAN Name                             Status    Ports')
  ctx.print('---- -------------------------------- --------- -------------------------------')
  const rows: [number, string, string][] = [
    ...device.vlans.map((v): [number, string, string] => [v.id, v.name, 'active']),
    ...RESERVED_VLANS.map(([id, name]): [number, string, string] => [id, name, 'act/unsup'])
  ]
  for (const [id, name, status] of rows) {
    const ports = device.interfaces
      .filter((p) => !p.svi && !p.l3)
      .filter((p) => {
        const sp = switchportOf(p)
        return sp.mode === 'access' && sp.accessVlan === id
      })
      .map((p) => p.name)
    const columns = portColumns(ports)
    ctx.print(`${String(id).padEnd(5)}${name.padEnd(33)}${status.padEnd(10)}${columns[0]}`.trimEnd())
    for (const more of columns.slice(1)) ctx.print(`${' '.repeat(48)}${more}`)
  }
}

function showInterfacesTrunk(ctx: IosRunContext): void {
  const device = deviceOf(ctx)
  if (device.kind !== 'switch') return
  const trunks = device.interfaces.filter(
    (p) => !p.svi && switchportOf(p).mode === 'trunk' && ifaceStatus(ctx.state, device, p).status === 'up'
  )
  if (trunks.length === 0) return
  const existing = device.vlans.map((v) => v.id)
  const allowed = (p: NetInterface) => switchportOf(p).allowedVlans
  ctx.print('')
  ctx.print('Port        Mode             Encapsulation  Status        Native vlan')
  for (const p of trunks)
    ctx.print(
      `${p.name.padEnd(12)}${'on'.padEnd(17)}${'802.1q'.padEnd(15)}${'trunking'.padEnd(14)}${switchportOf(p).nativeVlan}`
    )
  const section = (title: string, list: (p: NetInterface) => string) => {
    ctx.print('')
    ctx.print(`Port        ${title}`)
    for (const p of trunks) ctx.print(`${p.name.padEnd(12)}${list(p) || 'none'}`)
  }
  section('Vlans allowed on trunk', (p) =>
    allowed(p) === null ? '1-4094' : formatVlanList(allowed(p) ?? [])
  )
  const active = (p: NetInterface) =>
    formatVlanList(existing.filter((id) => allowed(p) === null || (allowed(p) ?? []).includes(id)))
  section('Vlans allowed and active in management domain', active)
  section('Vlans in spanning tree forwarding state and not pruned', active)
}

// ---------------------------------------------------------------------------
// Commandes
// ---------------------------------------------------------------------------

const SWITCHPORT = kw('switchport', 'Set switching mode characteristics')
const TRUNK = kw('trunk', 'Set trunking characteristics of the interface')
const ALLOWED = [
  TRUNK,
  kw('allowed', 'Set allowed VLAN characteristics when interface is in trunking mode'),
  kw('vlan', 'Set allowed VLANs when interface is in trunking mode')
]
const VLAN_LIST = {
  arg: 'list',
  type: vlanList(),
  help: 'VLAN IDs of the allowed VLANs when this port is in trunking mode'
}

const commands: CliCommand[] = [
  {
    modes: ['config'],
    syntax: [
      kw('vlan', 'Vlan commands'),
      { arg: 'list', type: vlanList('<1-4094>'), help: 'ISL VLAN IDs 1-1005' }
    ],
    available: isSwitch,
    run: (ctx, args) => enterVlans(ctx, args.list ?? ''),
    no: { run: (ctx, args) => removeVlans(ctx, args.list ?? '') }
  },
  {
    modes: ['config-vlan'],
    syntax: [
      kw('name', 'Ascii name of the VLAN'),
      {
        arg: 'name',
        type: {
          label: 'WORD',
          match: (t, i) => (t[i] !== undefined ? { consumed: 1, value: t[i] as string } : null)
        },
        help: 'The ascii name for the VLAN'
      }
    ],
    run: (ctx, args) => setVlanName(ctx, args.name ?? ''),
    no: { min: 1, run: (ctx) => setVlanName(ctx, null) }
  },
  {
    modes: ['config'],
    syntax: [kw('ip', 'Global IP configuration subcommands'), kw('routing', 'Enable IP routing')],
    available: isLayer3Switch,
    run: (ctx) =>
      update(ctx, (d) => {
        draftIosState(d).ipRouting = true
      }),
    no: {
      run: (ctx) =>
        update(ctx, (d) => {
          draftIosState(d).ipRouting = false
        })
    }
  },
  ...(['access', 'trunk'] as const).map((mode): CliCommand => ({
    modes: ['config-if'],
    syntax: [
      SWITCHPORT,
      kw('mode', 'Set trunking mode of the interface'),
      kw(
        mode,
        mode === 'access'
          ? 'Set trunking mode to ACCESS unconditionally'
          : 'Set trunking mode to TRUNK unconditionally'
      )
    ],
    available: switchPorts,
    run: (ctx) => setPorts(ctx, (p) => ({ ...p, mode })),
    no: { min: 2, run: (ctx) => setPorts(ctx, (p) => ({ ...p, mode: 'access' })) }
  })),
  {
    modes: ['config-if'],
    syntax: [
      SWITCHPORT,
      kw('access', 'Set access mode characteristics of the interface'),
      kw('vlan', 'Set VLAN when interface is in access mode'),
      { arg: 'vlan', type: number(1, 4094), help: 'VLAN ID of the VLAN when this port is in access mode' }
    ],
    available: switchPorts,
    run: (ctx, args) => setAccessVlan(ctx, Number(args.vlan)),
    no: { min: 3, run: (ctx) => setPorts(ctx, (p) => ({ ...p, accessVlan: 1 })) }
  },
  {
    modes: ['config-if'],
    syntax: [
      SWITCHPORT,
      TRUNK,
      kw('native', 'Set trunking native characteristics when interface is in trunking mode'),
      kw('vlan', 'Set native VLAN when interface is in trunking mode'),
      {
        arg: 'vlan',
        type: number(1, 4094),
        help: 'VLAN ID of the native VLAN when this port is in trunking mode'
      }
    ],
    available: switchPorts,
    run: (ctx, args) => setPorts(ctx, (p) => ({ ...p, nativeVlan: Number(args.vlan) })),
    no: { min: 4, run: (ctx) => setPorts(ctx, (p) => ({ ...p, nativeVlan: 1 })) }
  },
  {
    modes: ['config-if'],
    syntax: [SWITCHPORT, ...ALLOWED, VLAN_LIST],
    available: switchPorts,
    run: (ctx, args) => setAllowed(ctx, 'set', args.list),
    no: { min: 4, run: (ctx) => setAllowed(ctx, 'all') }
  },
  ...(['add', 'remove', 'except'] as const).map((action): CliCommand => ({
    modes: ['config-if'],
    syntax: [
      SWITCHPORT,
      ...ALLOWED,
      kw(
        action,
        action === 'add'
          ? 'add VLANs to the current list'
          : action === 'remove'
            ? 'remove VLANs from the current list'
            : 'all VLANs except the following'
      ),
      VLAN_LIST
    ],
    available: switchPorts,
    run: (ctx, args) => setAllowed(ctx, action, args.list)
  })),
  ...(['all', 'none'] as const).map((action): CliCommand => ({
    modes: ['config-if'],
    syntax: [SWITCHPORT, ...ALLOWED, kw(action, action === 'all' ? 'all VLANs' : 'no VLANs')],
    available: switchPorts,
    run: (ctx) => setAllowed(ctx, action)
  })),
  {
    modes: ['config-subif'],
    syntax: [
      kw('encapsulation', 'Set encapsulation type for an interface'),
      kw('dot1Q', 'IEEE 802.1Q Virtual LAN'),
      { arg: 'vlan', type: number(1, 4094), help: 'IEEE 802.1Q VLAN ID required' }
    ],
    available: subinterface,
    run: (ctx, args) => setEncapsulation(ctx, Number(args.vlan))
  },
  {
    modes: ['user', 'exec'],
    syntax: [
      kw('show', 'Show running system information'),
      kw('vlan', 'VTP VLAN status'),
      kw('brief', 'VTP all VLAN status in brief')
    ],
    available: isSwitch,
    run: showVlanBrief
  },
  {
    modes: ['user', 'exec'],
    syntax: [
      kw('show', 'Show running system information'),
      kw('interfaces', 'Interface status and configuration'),
      kw('trunk', 'Show interface trunk information')
    ],
    available: isSwitch,
    run: showInterfacesTrunk
  }
]

function config(device: IosDevice): ConfigBlock[] {
  const blocks: ConfigBlock[] = []
  if (device.kind === 'switch' && iosState(device).ipRouting)
    blocks.push({ order: 45, lines: ['ip routing'] })
  // Switch : Vlan1 d'usine (coupée) tant qu'elle n'a pas été configurée
  if (device.kind === 'switch' && !device.interfaces.some((i) => i.svi?.vlan === 1))
    blocks.push({ order: 100, lines: ['interface Vlan1', ' no ip address', ' shutdown'] })
  return blocks
}

function interfaceConfig(device: IosDevice, i: NetInterface): ConfigBlock[] {
  if (i.subinterface?.vlan) return [{ order: 5, lines: [`encapsulation dot1Q ${i.subinterface.vlan}`] }]
  if (device.kind !== 'switch' || i.svi || !i.switchport) return []
  const sp = i.switchport
  const lines: string[] = []
  if (sp.accessVlan !== DEFAULT_SWITCHPORT.accessVlan) lines.push(`switchport access vlan ${sp.accessVlan}`)
  if (sp.nativeVlan !== 1) lines.push(`switchport trunk native vlan ${sp.nativeVlan}`)
  if (sp.allowedVlans !== null)
    lines.push(`switchport trunk allowed vlan ${formatVlanList(sp.allowedVlans) || 'none'}`)
  lines.push(`switchport mode ${sp.mode}`)
  return [{ order: 20, lines }]
}

export const vlan = defineIosFeature({
  id: 'vlan',
  commands,
  config,
  interfaceConfig,
  // Switch de niveau 3 : route entre ses interfaces VLAN quand ip routing est actif
  transit: {
    forwards: (_state, device) => device.kind === 'switch' && isIos(device) && iosState(device).ipRouting
  }
})
