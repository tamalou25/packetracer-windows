/**
 * Cmdlets du module Hyper-V (outils RSAT Hyper-V) : commutateurs virtuels, machines virtuelles,
 * cartes réseau des machines virtuelles.
 */
import type { LabState } from '../../model/schema'
import { effectiveIpv4 } from '../../net/addressing'
import { psError } from '../../shell/ps/errors'
import type { CmdContext } from '../../shell/ps/interpreter'
import type { CmdletDef, ParamDef } from '../../shell/ps/registry'
import { psObject, psToString, type PsValue } from '../../shell/ps/values'
import { hasFeature } from '../../shell/ps/cmdlets/helpers'
import type { HyperVServer } from './schema'
import {
  addVMNetworkAdapter,
  connectVMNetworkAdapter,
  newVM,
  newVMSwitch,
  removeVM,
  removeVMSwitch,
  setVMMemory,
  setVMState,
  switchOfAdapter
} from './actions'
import { hyperVOf } from './state'

const MODULE = 'Hyper-V'
const available = (ctx: CmdContext) => hasFeature(ctx, 'Hyper-V-PowerShell')
const str = (v: PsValue | undefined): string => psToString(v)

function hvOf(ctx: CmdContext): HyperVServer {
  const hv = hyperVOf(ctx.device)
  if (!hv || !hasFeature(ctx, 'Hyper-V'))
    throw psError(
      `Hyper-V n’est pas installé sur l’ordinateur « ${ctx.device.name} ».`,
      'ObjectNotFound',
      'Unspecified,Microsoft.HyperV.PowerShell.Commands.GetVM'
    )
  return hv
}

/** Taille en Mo : nombre d'octets (2147483648) ou valeur avec unité (2GB, 512MB). */
function megabytes(v: PsValue | undefined): number | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v === 'number') return Math.round(v / (1024 * 1024))
  const m = /^(\d+)\s*(KB|MB|GB|TB)?$/i.exec(str(v).trim())
  if (!m) throw psError(`La taille « ${str(v)} » n’est pas valide.`, 'InvalidArgument', 'InvalidParameter')
  const n = Number(m[1])
  const unit = (m[2] ?? '').toUpperCase()
  const bytes =
    unit === 'TB'
      ? n * 1024 ** 4
      : unit === 'GB'
        ? n * 1024 ** 3
        : unit === 'MB'
          ? n * 1024 ** 2
          : unit === 'KB'
            ? n * 1024
            : n
  return Math.round(bytes / (1024 * 1024))
}

function vmDevices(state: LabState, hv: HyperVServer) {
  return hv.vms.flatMap((vm) => {
    const device = state.devices[vm.deviceId]
    return device ? [{ vm, device }] : []
  })
}

const vmNames = (ctx: CmdContext) => {
  const hv = hyperVOf(ctx.device)
  return hv ? vmDevices(ctx.state, hv).map((v) => v.device.name) : []
}
const switchNames = (ctx: CmdContext) => hyperVOf(ctx.device)?.switches.map((s) => s.name) ?? []
const vmNameParam: ParamDef = {
  name: 'Name',
  type: 'string',
  position: 0,
  complete: vmNames,
  aliases: ['VMName']
}
const switchParam: ParamDef = { name: 'SwitchName', type: 'string', complete: switchNames }

/** Machine virtuelle désignée par -Name / -VMName (erreur si inconnue). */
function vmName(ctx: CmdContext, args: Record<string, PsValue>, key = 'Name'): string {
  const name = str(args[key])
  if (!vmNames(ctx).some((n) => n.toLowerCase() === name.toLowerCase()))
    throw psError(
      `Hyper-V n’a pas trouvé de machine virtuelle nommée « ${name} ».`,
      'InvalidArgument',
      'InvalidParameter,Microsoft.HyperV.PowerShell.Commands.GetVM',
      name
    )
  return name
}

export const hypervCmdlets: CmdletDef[] = [
  {
    name: 'New-VMSwitch',
    module: MODULE,
    synopsis: 'Crée un commutateur virtuel.',
    available,
    params: [
      { name: 'Name', type: 'string', mandatory: true, position: 0 },
      { name: 'SwitchType', type: 'string', validateSet: ['Internal', 'Private'] },
      { name: 'NetAdapterName', type: 'string' },
      { name: 'AllowManagementOS', type: 'bool' }
    ],
    run(ctx, args) {
      hvOf(ctx)
      const external = args['NetAdapterName'] !== undefined
      if (external && args['SwitchType'] !== undefined)
        throw psError(
          'Les paramètres SwitchType et NetAdapterName ne peuvent pas être utilisés ensemble.',
          'InvalidArgument',
          'AmbiguousParameterSet'
        )
      if (!external && args['SwitchType'] === undefined)
        throw psError(
          'Indiquez -SwitchType (Internal ou Private) ou -NetAdapterName pour un commutateur externe.',
          'InvalidArgument',
          'AmbiguousParameterSet'
        )
      const name = str(args['Name'])
      ctx.apply(
        newVMSwitch(ctx.state, ctx.deviceId, {
          name,
          type: external ? 'External' : (str(args['SwitchType']) as 'Internal' | 'Private'),
          ...(external ? { netAdapter: str(args['NetAdapterName']) } : {}),
          ...(args['AllowManagementOS'] !== undefined
            ? { allowManagementOS: args['AllowManagementOS'] === true }
            : {})
        })
      )
      const sw = hvOf(ctx).switches.find((s) => s.name === name.trim())
      return sw ? [switchObject(ctx, sw)] : []
    }
  },
  {
    name: 'Get-VMSwitch',
    module: MODULE,
    synopsis: 'Liste les commutateurs virtuels.',
    available,
    params: [{ name: 'Name', type: 'string', position: 0, complete: switchNames }],
    run(ctx, args) {
      const name = args['Name'] ? str(args['Name']).toLowerCase() : null
      return hvOf(ctx)
        .switches.filter((s) => !name || s.name.toLowerCase() === name)
        .map((s) => switchObject(ctx, s))
    }
  },
  {
    name: 'Remove-VMSwitch',
    module: MODULE,
    synopsis: 'Supprime un commutateur virtuel.',
    available,
    params: [
      { name: 'Name', type: 'string', mandatory: true, position: 0, complete: switchNames },
      { name: 'Force', type: 'switch' }
    ],
    run(ctx, args) {
      hvOf(ctx)
      const name = str(args['Name'])
      if (!ctx.confirm(name, 'Supprimer le commutateur virtuel')) return
      ctx.apply(removeVMSwitch(ctx.state, ctx.deviceId, name))
    }
  },
  {
    name: 'New-VM',
    module: MODULE,
    synopsis: 'Crée une machine virtuelle.',
    available,
    params: [
      { name: 'Name', type: 'string', mandatory: true, position: 0 },
      { name: 'MemoryStartupBytes', type: 'any' },
      { name: 'Generation', type: 'int' },
      switchParam,
      { name: 'NewVHDPath', type: 'string' },
      { name: 'NewVHDSizeBytes', type: 'any' },
      { name: 'Path', type: 'string' }
    ],
    run(ctx, args) {
      hvOf(ctx)
      const generation = args['Generation'] === undefined ? 1 : Number(args['Generation'])
      if (generation !== 1 && generation !== 2)
        throw psError('La génération doit être 1 ou 2.', 'InvalidArgument', 'InvalidParameter')
      const name = str(args['Name'])
      const memoryMB = megabytes(args['MemoryStartupBytes'])
      ctx.apply(
        newVM(ctx.state, ctx.deviceId, {
          name,
          generation,
          ...(memoryMB !== undefined ? { memoryMB } : {}),
          ...(args['SwitchName'] ? { switchName: str(args['SwitchName']) } : {})
        })
      )
      return vmObjects(ctx, name)
    }
  },
  {
    name: 'Get-VM',
    module: MODULE,
    synopsis: 'Liste les machines virtuelles.',
    available,
    params: [{ ...vmNameParam }],
    run(ctx, args) {
      hvOf(ctx)
      if (args['Name']) vmName(ctx, args)
      return vmObjects(ctx, args['Name'] ? str(args['Name']) : null)
    }
  },
  {
    name: 'Start-VM',
    module: MODULE,
    synopsis: 'Démarre une machine virtuelle.',
    available,
    params: [{ ...vmNameParam, mandatory: true }],
    run(ctx, args) {
      hvOf(ctx)
      ctx.apply(setVMState(ctx.state, ctx.deviceId, vmName(ctx, args), true))
    }
  },
  {
    name: 'Stop-VM',
    module: MODULE,
    synopsis: 'Arrête une machine virtuelle.',
    available,
    params: [
      { ...vmNameParam, mandatory: true },
      { name: 'Force', type: 'switch' },
      { name: 'TurnOff', type: 'switch' }
    ],
    run(ctx, args) {
      hvOf(ctx)
      ctx.apply(setVMState(ctx.state, ctx.deviceId, vmName(ctx, args), false))
    }
  },
  {
    name: 'Remove-VM',
    module: MODULE,
    synopsis: 'Supprime une machine virtuelle.',
    available,
    params: [
      { ...vmNameParam, mandatory: true },
      { name: 'Force', type: 'switch' }
    ],
    run(ctx, args) {
      hvOf(ctx)
      const name = vmName(ctx, args)
      if (!ctx.confirm(name, 'Supprimer la machine virtuelle')) return
      ctx.apply(removeVM(ctx.state, ctx.deviceId, name))
    }
  },
  {
    name: 'Set-VM',
    module: MODULE,
    synopsis: 'Modifie la configuration d’une machine virtuelle (mémoire de démarrage).',
    available,
    params: [
      { ...vmNameParam, mandatory: true },
      { name: 'MemoryStartupBytes', type: 'any' }
    ],
    run(ctx, args) {
      hvOf(ctx)
      const name = vmName(ctx, args)
      const mb = megabytes(args['MemoryStartupBytes'])
      if (mb !== undefined) ctx.apply(setVMMemory(ctx.state, ctx.deviceId, name, mb))
    }
  },
  {
    name: 'Get-VMNetworkAdapter',
    module: MODULE,
    synopsis: 'Liste les cartes réseau d’une machine virtuelle.',
    available,
    params: [{ name: 'VMName', type: 'string', position: 0, mandatory: true, complete: vmNames }],
    run(ctx, args) {
      const hv = hvOf(ctx)
      const name = vmName(ctx, args, 'VMName')
      const entry = vmDevices(ctx.state, hv).find((v) => v.device.name.toLowerCase() === name.toLowerCase())
      if (!entry) return []
      return entry.device.interfaces.map((iface) => {
        const sw = switchOfAdapter(ctx.state, hv, entry.device.id, iface.id)
        const ip = entry.device.powered ? effectiveIpv4(iface)?.address : undefined
        return psObject(
          'Microsoft.HyperV.PowerShell.VMNetworkAdapter',
          {
            Name: 'Carte réseau',
            IsManagementOs: false,
            VMName: entry.device.name,
            SwitchName: sw?.name ?? '',
            MacAddress: iface.mac.replace(/-/g, ''),
            Status: entry.device.powered ? '{Ok}' : '{}',
            IPAddresses: ip ? `{${ip}}` : '{}'
          },
          {
            kind: 'table',
            props: ['Name', 'IsManagementOs', 'VMName', 'SwitchName', 'MacAddress', 'Status', 'IPAddresses']
          }
        )
      })
    }
  },
  {
    name: 'Connect-VMNetworkAdapter',
    module: MODULE,
    synopsis: 'Connecte la carte réseau d’une machine virtuelle à un commutateur virtuel.',
    available,
    params: [
      { name: 'VMName', type: 'string', position: 0, mandatory: true, complete: vmNames },
      { ...switchParam, mandatory: true }
    ],
    run(ctx, args) {
      hvOf(ctx)
      ctx.apply(
        connectVMNetworkAdapter(ctx.state, ctx.deviceId, vmName(ctx, args, 'VMName'), str(args['SwitchName']))
      )
    }
  },
  {
    name: 'Disconnect-VMNetworkAdapter',
    module: MODULE,
    synopsis: 'Déconnecte la carte réseau d’une machine virtuelle.',
    available,
    params: [{ name: 'VMName', type: 'string', position: 0, mandatory: true, complete: vmNames }],
    run(ctx, args) {
      hvOf(ctx)
      ctx.apply(connectVMNetworkAdapter(ctx.state, ctx.deviceId, vmName(ctx, args, 'VMName'), null))
    }
  },
  {
    name: 'Add-VMNetworkAdapter',
    module: MODULE,
    synopsis: 'Ajoute une carte réseau à une machine virtuelle.',
    available,
    params: [
      { name: 'VMName', type: 'string', position: 0, mandatory: true, complete: vmNames },
      switchParam
    ],
    run(ctx, args) {
      hvOf(ctx)
      ctx.apply(
        addVMNetworkAdapter(
          ctx.state,
          ctx.deviceId,
          vmName(ctx, args, 'VMName'),
          args['SwitchName'] ? str(args['SwitchName']) : null
        )
      )
    }
  }
]

function switchObject(ctx: CmdContext, s: HyperVServer['switches'][number]) {
  const host = ctx.device
  const uplink = host.interfaces.find((i) => i.id === s.netAdapter)
  return psObject(
    'Microsoft.HyperV.PowerShell.VMSwitch',
    {
      Name: s.name,
      SwitchType: s.type,
      NetAdapterInterfaceDescription: uplink ? `Carte réseau ${uplink.name}` : ''
    },
    { kind: 'table', props: ['Name', 'SwitchType', 'NetAdapterInterfaceDescription'] }
  )
}

function vmObjects(ctx: CmdContext, name: string | null) {
  const hv = hvOf(ctx)
  return vmDevices(ctx.state, hv)
    .filter((v) => !name || v.device.name.toLowerCase() === name.trim().toLowerCase())
    .map(({ vm, device }) =>
      psObject(
        'Microsoft.HyperV.PowerShell.VirtualMachine',
        {
          Name: device.name,
          State: device.powered ? 'Running' : 'Off',
          'CPUUsage(%)': 0,
          'MemoryAssigned(M)': device.powered ? vm.memoryMB : 0,
          Uptime: '00:00:00',
          Status: 'Fonctionne normalement',
          Version: '10.0',
          Generation: vm.generation
        },
        {
          kind: 'table',
          props: ['Name', 'State', 'CPUUsage(%)', 'MemoryAssigned(M)', 'Uptime', 'Status', 'Version']
        }
      )
    )
}
