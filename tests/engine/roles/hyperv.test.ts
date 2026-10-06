/**
 * Rôle Hyper-V : machines et commutateurs virtuels hébergés, isolement selon le type de
 * commutateur (privé, interne, externe), garde-fous de topologie et cmdlets.
 */
import { describe, expect, it } from 'vitest'
import {
  command,
  connect,
  dispatch,
  evaluateCheck,
  hyperVOf,
  installFeatures,
  parseSlab,
  ping,
  removeDevices,
  serializeSlab,
  setPower,
  uninstallFeatures,
  unwrap,
  type AnyCommand,
  type LabState
} from '@engine/index'
import { build, cable, setIp } from '../helpers'
import { run } from '../shell/helpers'

const id = (s: LabState, name: string) => Object.values(s.devices).find((d) => d.name === name)?.id ?? ''

function exec(state: LabState, ...cmds: AnyCommand[]): LabState {
  let s = state
  for (const cmd of cmds) {
    const r = dispatch(s, cmd)
    if (!r.ok) throw new Error(`${cmd.type} : ${r.error.message}`)
    s = r.state
  }
  return s
}

/** IP statique de la carte n°index d'un équipement désigné par son nom. */
const ip = (s: LabState, name: string, cidr: string, index = 0) => setIp(s, id(s, name), index, cidr)

const pings = (s: LabState, from: string, to: string) => {
  const r = ping(s, id(s, from), to, { count: 1 })
  return r.ok && r.value.success
}

/** SRV1 (Hyper-V, 192.168.1.1) et PC1 (192.168.1.10) reliés par SW1. */
function lab(): LabState {
  const { state, ids } = build([
    ['server', 'SRV1'],
    ['client', 'PC1'],
    ['switch', 'SW1']
  ])
  let s = cable(state, ids.SRV1!, 0, ids.SW1!, 0)
  s = cable(s, ids.PC1!, 0, ids.SW1!, 1)
  s = setIp(s, ids.SRV1!, 0, '192.168.1.1/24')
  s = setIp(s, ids.PC1!, 0, '192.168.1.10/24')
  return unwrap(installFeatures(s, ids.SRV1!, ['Hyper-V'], { includeManagementTools: true })).state
}

describe('Hyper-V', () => {
  it('acceptation : une VM sur un commutateur privé ne joint pas le réseau physique', () => {
    let s = lab()
    const srv = id(s, 'SRV1')
    s = exec(
      s,
      command('hyperv.newSwitch', srv, { name: 'Privé', type: 'Private' }),
      command('hyperv.newVm', srv, { name: 'VM1', switchName: 'Privé' }),
      command('hyperv.newVm', srv, { name: 'VM2', switchName: 'Privé' })
    )
    // Même sous-réseau que le réseau physique : seul le commutateur virtuel compte
    s = ip(ip(s, 'VM1', '192.168.1.51/24'), 'VM2', '192.168.1.52/24')
    expect(pings(s, 'VM1', '192.168.1.52')).toBe(false) // VM arrêtées
    s = exec(
      s,
      command('hyperv.setVmState', srv, 'VM1', true),
      command('hyperv.setVmState', srv, 'VM2', true)
    )
    expect(pings(s, 'VM1', '192.168.1.52')).toBe(true)
    expect(pings(s, 'VM1', '192.168.1.10')).toBe(false)
    expect(pings(s, 'VM1', '192.168.1.1')).toBe(false)
    expect(pings(s, 'PC1', '192.168.1.51')).toBe(false)
    expect(evaluateCheck(s, { type: 'ping', from: 'VM1', to: 'PC1', success: false })).toBe(true)
    expect(evaluateCheck(s, { type: 'ping', from: 'VM1', to: 'VM2' })).toBe(true)
    expect(
      evaluateCheck(s, { type: 'virtualMachine', host: 'SRV1', name: 'vm1', running: true, switch: 'privé' })
    ).toBe(true)
    expect(evaluateCheck(s, { type: 'vmSwitch', host: 'SRV1', name: 'Privé', switchType: 'Private' })).toBe(
      true
    )
  })

  it('commutateur interne : la VM joint l’hôte (vEthernet) mais pas le réseau physique', () => {
    let s = lab()
    const srv = id(s, 'SRV1')
    s = exec(
      s,
      command('hyperv.newSwitch', srv, { name: 'Interne', type: 'Internal' }),
      command('hyperv.newVm', srv, { name: 'VM3', switchName: 'Interne', guest: 'client' })
    )
    const host = s.devices[srv]!
    expect(host.interfaces.map((i) => i.name)).toEqual(['Ethernet0', 'vEthernet (Interne)'])
    s = ip(s, 'SRV1', '172.16.0.1/24', 1)
    s = ip(s, 'VM3', '172.16.0.10/24')
    s = exec(s, command('hyperv.setVmState', srv, 'VM3', true))
    expect(s.devices[id(s, 'VM3')]!.kind).toBe('client')
    expect(pings(s, 'VM3', '172.16.0.1')).toBe(true)
    expect(pings(s, 'SRV1', '172.16.0.10')).toBe(true)
    expect(pings(s, 'VM3', '192.168.1.10')).toBe(false)
  })

  it('commutateur externe : la VM rejoint le réseau physique ; l’IP de l’hôte passe sur vEthernet', () => {
    let s = lab()
    const srv = id(s, 'SRV1')
    s = exec(
      s,
      command('hyperv.newSwitch', srv, { name: 'Externe', type: 'External', netAdapter: 'Ethernet0' }),
      command('hyperv.newVm', srv, { name: 'VM4', switchName: 'Externe' })
    )
    const host = s.devices[srv]!
    expect(host.interfaces[0]).toMatchObject({ name: 'Ethernet0', address: null, bridge: expect.any(String) })
    expect(host.interfaces[1]).toMatchObject({ name: 'vEthernet (Externe)', address: '192.168.1.1' })
    s = ip(s, 'VM4', '192.168.1.60/24')
    s = exec(s, command('hyperv.setVmState', srv, 'VM4', true))
    expect(pings(s, 'VM4', '192.168.1.10')).toBe(true)
    expect(pings(s, 'PC1', '192.168.1.60')).toBe(true)
    expect(pings(s, 'SRV1', '192.168.1.10')).toBe(true)
    expect(pings(s, 'VM4', '192.168.1.1')).toBe(true)
    // VM déconnectée : plus de réseau
    const off = exec(s, command('hyperv.connectAdapter', srv, 'VM4', null))
    expect(pings(off, 'VM4', '192.168.1.10')).toBe(false)
    // Suppression du commutateur : l'IP revient sur la carte physique
    s = exec(s, command('hyperv.removeSwitch', srv, 'Externe'))
    expect(s.devices[srv]!.interfaces).toHaveLength(1)
    expect(s.devices[srv]!.interfaces[0]).toMatchObject({ address: '192.168.1.1', bridge: null })
    expect(pings(s, 'SRV1', '192.168.1.10')).toBe(true)
    expect(pings(s, 'VM4', '192.168.1.10')).toBe(false)
  })

  it('externe sans partage avec le système de gestion : l’hôte perd l’accès au réseau', () => {
    let s = lab()
    const srv = id(s, 'SRV1')
    s = exec(
      s,
      command('hyperv.newSwitch', srv, {
        name: 'Externe',
        type: 'External',
        netAdapter: 'Ethernet0',
        allowManagementOS: false
      })
    )
    expect(s.devices[srv]!.interfaces).toHaveLength(1)
    expect(pings(s, 'SRV1', '192.168.1.10')).toBe(false)
  })

  it('garde-fous : câble, suppression, extinction de l’hôte, désinstallation du rôle', () => {
    let s = lab()
    const srv = id(s, 'SRV1')
    s = exec(
      s,
      command('hyperv.newSwitch', srv, { name: 'Privé', type: 'Private' }),
      command('hyperv.newVm', srv, { name: 'VM1', switchName: 'Privé' })
    )
    const vm = id(s, 'VM1')
    const sw1 = id(s, 'SW1')
    const cableVm = connect(
      s,
      { deviceId: vm, ifaceId: s.devices[vm]!.interfaces[0]!.id },
      {
        deviceId: sw1,
        ifaceId: s.devices[sw1]!.interfaces[5]!.id
      }
    )
    expect(!cableVm.ok && cableVm.error.code).toBe('HyperVManaged')
    const virtual = Object.values(s.links).find((l) => l.virtual)!
    const unplug = dispatch(s, command('topology.disconnect', virtual.id))
    expect(!unplug.ok && unplug.error.code).toBe('HyperVManaged')
    const remove = removeDevices(s, [vm])
    expect(!remove.ok && remove.error.code).toBe('HyperVManaged')
    const removeRole = uninstallFeatures(s, srv, ['Hyper-V'])
    expect(!removeRole.ok && removeRole.error.code).toBe('HyperVInUse')
    expect(s.devices[vm]!.interfaces[0]!.mac).toMatch(/^00-15-5D-/)
    // Hôte éteint : VM arrêtée ; démarrage impossible
    s = exec(s, command('hyperv.setVmState', srv, 'VM1', true))
    s = unwrap(setPower(s, srv, false)).state
    expect(s.devices[vm]!.powered).toBe(false)
    expect(setPower(s, vm, true).ok).toBe(false)
    // VM en cours d'exécution : suppression refusée ; hôte supprimé : VM et commutateur supprimés
    s = unwrap(setPower(s, srv, true)).state
    s = exec(s, command('hyperv.setVmState', srv, 'VM1', true))
    const running = dispatch(s, command('hyperv.removeVm', srv, 'VM1'))
    expect(!running.ok && running.error.code).toBe('VmRunning')
    const gone = unwrap(removeDevices(s, [srv])).state
    expect(Object.values(gone.devices).map((d) => d.name)).toEqual(['PC1', 'SW1'])
    expect(Object.values(gone.links).some((l) => l.virtual)).toBe(false)
  })

  it('enregistrement .slab : machines, commutateurs et liaisons virtuelles conservés', () => {
    let s = lab()
    const srv = id(s, 'SRV1')
    s = exec(
      s,
      command('hyperv.newSwitch', srv, { name: 'Externe', type: 'External', netAdapter: 'Ethernet0' }),
      command('hyperv.newVm', srv, { name: 'VM1', switchName: 'Externe', memoryMB: 2048, generation: 2 })
    )
    const reopened = parseSlab(serializeSlab(s, { savedAt: '2026-10-06T12:00:00.000Z', appVersion: '2.1.0' }))
    expect(reopened.ok && reopened.doc.lab).toEqual(s)
  })

  it('cmdlets Hyper-V : même état que le Gestionnaire Hyper-V', () => {
    let s = lab()
    const srv = id(s, 'SRV1')
    s = run(s, srv, "New-VMSwitch -Name 'Privé' -SwitchType Private").state
    s = run(s, srv, "New-VM -Name VM1 -MemoryStartupBytes 2GB -Generation 2 -SwitchName 'Privé'").state
    const viaGui = exec(
      lab(),
      command('hyperv.newSwitch', srv, { name: 'Privé', type: 'Private' }),
      command('hyperv.newVm', srv, { name: 'VM1', memoryMB: 2048, generation: 2, switchName: 'Privé' })
    )
    expect(hyperVOf(s.devices[srv])).toEqual(hyperVOf(viaGui.devices[srv]))
    expect(run(s, srv, 'Get-VM').text).toMatch(/VM1\s+Off/)
    s = run(s, srv, 'Start-VM -Name VM1').state
    expect(run(s, srv, 'Get-VM VM1').text).toMatch(/VM1\s+Running\s+0\s+2048/)
    expect(run(s, srv, 'Get-VMSwitch').text).toMatch(/Privé\s+Private/)
    expect(run(s, srv, 'Get-VMNetworkAdapter -VMName VM1').text).toMatch(
      /Carte réseau\s+False\s+VM1\s+Privé\s+00155D/
    )
    s = run(s, srv, 'Disconnect-VMNetworkAdapter -VMName VM1').state
    expect(run(s, srv, 'Get-VMNetworkAdapter -VMName VM1').text).not.toContain('Privé')
    s = run(s, srv, "Connect-VMNetworkAdapter -VMName VM1 -SwitchName 'Privé'").state
    s = run(s, srv, 'Stop-VM -Name VM1 -Force').state
    s = run(s, srv, 'Set-VM -Name VM1 -MemoryStartupBytes 4096MB').state
    s = run(s, srv, "Add-VMNetworkAdapter -VMName VM1 -SwitchName 'Privé'").state
    expect(s.devices[id(s, 'VM1')]!.interfaces).toHaveLength(2)
    expect(hyperVOf(s.devices[srv])!.vms[0]!.memoryMB).toBe(4096)
    expect(run(s, srv, 'Start-VM -Name Inconnue').errors).toMatch(/n’a pas trouvé de machine virtuelle/)
    expect(run(s, srv, 'New-VMSwitch -Name X').errors).toMatch(/SwitchType/)
    s = run(s, srv, 'Remove-VM -Name VM1 -Force').state
    s = run(s, srv, "Remove-VMSwitch -Name 'Privé' -Force").state
    expect(hyperVOf(s.devices[srv])).toEqual({ switches: [], vms: [] })
    s = run(s, srv, 'New-VMSwitch -Name Externe -NetAdapterName Ethernet0 -AllowManagementOS $true').state
    expect(hyperVOf(s.devices[srv])!.switches[0]!.type).toBe('External')
  })
})
