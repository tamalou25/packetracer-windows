/**
 * Relais DHCP (ip helper-address) : un serveur DHCP unique sert plusieurs VLAN ; l'étendue est
 * choisie d'après l'adresse de l'agent de relais (giaddr).
 */
import { describe, expect, it } from 'vitest'
import {
  addScope,
  addSubinterface,
  command,
  dhcpAcquire,
  dhcpRenew,
  dispatch,
  installFeatures,
  setDhcpOptions,
  setHelperAddresses,
  setInterfaceIpv4,
  setSwitchport,
  unwrap,
  type LabState
} from '@engine/index'
import { build, cable, setIp } from '../helpers'

const port = (s: LabState, device: string, index: number) => s.devices[device]!.interfaces[index]!.id
const sub = (s: LabState, router: string, name: string) =>
  s.devices[router]!.interfaces.find((i) => i.name === name)!.id

function dhcpClient(s: LabState, id: string): LabState {
  return unwrap(
    setInterfaceIpv4(s, id, port(s, id, 0), { addressing: 'dhcp', address: '', mask: '', dnsServers: [] })
  ).state
}

/**
 * SRV1 (DHCP, VLAN 10, 192.168.10.1) et PC1 (VLAN 10), PC2 (VLAN 20) sur SW1 ; R1 « on a stick »
 * (Gi0/0.10 192.168.10.254, Gi0/0.20 192.168.20.254). Étendues des deux réseaux sur SRV1.
 */
function lab(options: { helper?: boolean; scope20?: boolean; serverGateway?: boolean } = {}) {
  const { helper = true, scope20 = true, serverGateway = true } = options
  const { state, ids } = build([
    ['server', 'SRV1'],
    ['client', 'PC1'],
    ['client', 'PC2'],
    ['switch', 'SW1'],
    ['router', 'R1']
  ])
  const sw = ids.SW1!
  const r1 = ids.R1!
  const srv = ids.SRV1!
  let s = cable(state, srv, 0, sw, 0)
  s = cable(s, ids.PC1!, 0, sw, 1)
  s = cable(s, ids.PC2!, 0, sw, 2)
  s = cable(s, r1, 0, sw, 15)
  for (const [i, vlan] of [
    [0, 10],
    [1, 10],
    [2, 20]
  ] as const)
    s = unwrap(setSwitchport(s, sw, port(s, sw, i), { mode: 'access', accessVlan: vlan })).state
  s = unwrap(setSwitchport(s, sw, port(s, sw, 15), { mode: 'trunk' })).state
  for (const vlan of [10, 20]) {
    const r = unwrap(addSubinterface(s, r1, port(s, r1, 0), vlan))
    s = unwrap(
      setInterfaceIpv4(r.state, r1, r.value, {
        addressing: 'static',
        address: `192.168.${vlan}.254`,
        mask: '24',
        gateway: null,
        dnsServers: []
      })
    ).state
  }
  if (helper) s = unwrap(setHelperAddresses(s, r1, sub(s, r1, 'Gi0/0.20'), ['192.168.10.1'])).state
  s = setIp(s, srv, 0, '192.168.10.1/24', serverGateway ? '192.168.10.254' : undefined)
  s = unwrap(installFeatures(s, srv, ['DHCP'], { includeManagementTools: true })).state
  for (const vlan of scope20 ? [10, 20] : [10]) {
    const scope = unwrap(
      addScope(s, srv, {
        name: `VLAN${vlan}`,
        start: `192.168.${vlan}.100`,
        end: `192.168.${vlan}.200`,
        mask: '255.255.255.0'
      })
    )
    s = unwrap(
      setDhcpOptions(scope.state, srv, scope.value, { router: [`192.168.${vlan}.254`], dnsServers: [] })
    ).state
  }
  s = dhcpClient(dhcpClient(s, ids.PC1!), ids.PC2!)
  return { s, ids }
}

describe('Relais DHCP', () => {
  it('acceptation : un même serveur DHCP sert deux VLAN, l’un par relais', () => {
    const { s, ids } = lab()
    const local = dhcpAcquire(s, ids.PC1!, port(s, ids.PC1!, 0))
    expect(local.outcome).toBe('bound')
    expect(local.address).toBe('192.168.10.100')
    const relayed = dhcpAcquire(local.state, ids.PC2!, port(s, ids.PC2!, 0))
    expect(relayed.outcome).toBe('bound')
    expect(relayed.address).toBe('192.168.20.100')
    const lease = relayed.state.devices[ids.PC2!]!.interfaces[0]!.dhcpLease
    expect(lease?.gateway).toBe('192.168.20.254')
    expect(lease?.serverId).toBe('192.168.10.1')
    expect(lease?.serverDeviceId).toBe(ids.SRV1!)
  })

  it('giaddr visible en mode Simulation ; choix de l’étendue expliqué', () => {
    const { s, ids } = lab()
    const op = dhcpAcquire(s, ids.PC2!, port(s, ids.PC2!, 0))
    const relayedEvents = op.trace.events.filter((e) =>
      e.layers.some((l) => l.fields.some(([k, v]) => k === 'Agent relais (giaddr)' && v === '192.168.20.254'))
    )
    expect(relayedEvents.length).toBeGreaterThan(0)
    expect(relayedEvents.map((e) => e.summary)).toEqual(
      expect.arrayContaining([
        'DHCP Discover relayé (giaddr 192.168.20.254)',
        'DHCP Offer 192.168.20.100 (vers l’agent de relais)'
      ])
    )
    const notes = op.trace.events.map((e) => e.note).join('\n')
    expect(notes).toContain('est agent de relais DHCP (ip helper-address)')
    expect(notes).toContain('d’après l’adresse de l’agent de relais 192.168.20.254')
    // Les trames relayées traversent le trunk étiquetées (VLAN 20 puis VLAN 10)
    const tags = op.trace.events.flatMap((e) =>
      e.layers.filter((l) => l.name === '802.1Q').map((l) => l.fields.find(([k]) => k === 'VLAN')?.[1])
    )
    expect(tags).toEqual(expect.arrayContaining(['10', '20']))
  })

  it('sans relais, sans étendue ou sans route de retour : aucune adresse', () => {
    const noHelper = lab({ helper: false })
    expect(dhcpAcquire(noHelper.s, noHelper.ids.PC2!, port(noHelper.s, noHelper.ids.PC2!, 0)).outcome).toBe(
      'failed'
    )
    const noScope = lab({ scope20: false })
    const op = dhcpAcquire(noScope.s, noScope.ids.PC2!, port(noScope.s, noScope.ids.PC2!, 0))
    expect(op.outcome).toBe('failed')
    expect(op.trace.events.map((e) => e.note).join('\n')).toContain(
      'aucune étendue active pour le réseau de l’agent de relais 192.168.20.254'
    )
    // Le serveur n'a pas de passerelle : il ne peut pas répondre à l'agent de relais
    const noRoute = lab({ serverGateway: false })
    expect(dhcpAcquire(noRoute.s, noRoute.ids.PC2!, port(noRoute.s, noRoute.ids.PC2!, 0)).outcome).toBe(
      'failed'
    )
  })

  it('renouvellement d’un bail relayé : même adresse', () => {
    const { s, ids } = lab()
    const first = dhcpAcquire(s, ids.PC2!, port(s, ids.PC2!, 0))
    const again = dhcpRenew(first.state, ids.PC2!, port(s, ids.PC2!, 0))
    expect(again.address).toBe('192.168.20.100')
  })

  it('ip helper-address : routeur seulement, adresses valides, commande nommée', () => {
    const { s, ids } = lab({ helper: false })
    const r1 = ids.R1!
    const gi = sub(s, r1, 'Gi0/0.20')
    const bad = setHelperAddresses(s, r1, gi, ['300.1.1.1'])
    expect(!bad.ok && bad.error.code).toBe('InvalidAddress')
    const notRouter = setHelperAddresses(s, ids.PC1!, port(s, ids.PC1!, 0), ['192.168.10.1'])
    expect(!notRouter.ok && notRouter.error.code).toBe('NotSupported')
    const r = dispatch(s, command('net.setHelperAddresses', r1, gi, ['192.168.10.1']))
    expect(r.ok && r.entry?.label).toBe('Relayer DHCP de R1 Gi0/0.20 vers 192.168.10.1')
    const off = r.ok ? unwrap(setHelperAddresses(r.state, r1, gi, [])).state : s
    expect(off.devices[r1]!.interfaces.find((i) => i.id === gi)!.helperAddresses).toBeUndefined()
  })
})
