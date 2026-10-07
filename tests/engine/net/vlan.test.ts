/**
 * VLAN 802.1Q : ports d'accès, trunks (VLAN autorisés, VLAN natif), base des VLAN, sous-interfaces
 * de routeur et routage inter-VLAN (routeur « on a stick »).
 */
import { describe, expect, it } from 'vitest'
import {
  addSubinterface,
  addVlan,
  command,
  connect,
  dispatch,
  duplicateDevices,
  l2Segment,
  ping,
  removeSubinterface,
  removeVlan,
  renameVlan,
  setInterfaceEnabled,
  setInterfaceIpv4,
  setSwitchport,
  tracert,
  unwrap,
  type LabState,
  type RouterDevice,
  type SwitchDevice
} from '@engine/index'
import { build, cable, setIp } from '../helpers'

function pingOk(state: LabState, src: string, dst: string): boolean {
  const r = ping(state, src, dst, { count: 1 })
  if (!r.ok) throw new Error(r.error.message)
  return r.value.success
}

const port = (s: LabState, device: string, index: number) => s.devices[device]!.interfaces[index]!.id

function access(s: LabState, sw: string, index: number, vlan: number): LabState {
  return unwrap(setSwitchport(s, sw, port(s, sw, index), { mode: 'access', accessVlan: vlan })).state
}

/**
 * PC1 (Fa0/1, VLAN 10, 192.168.10.10) et PC2 (Fa0/2, VLAN 20, 192.168.20.10) sur SW1 ;
 * R1 Gi0/0 sur le trunk Fa0/16, sous-interfaces Gi0/0.10 et Gi0/0.20 (passerelles .254).
 */
function onAStick(withRouter = true) {
  const { state, ids } = build([
    ['client', 'PC1'],
    ['client', 'PC2'],
    ['switch', 'SW1'],
    ['router', 'R1']
  ])
  const sw = ids.SW1!
  const r1 = ids.R1!
  let s = cable(state, ids.PC1!, 0, sw, 0)
  s = cable(s, ids.PC2!, 0, sw, 1)
  s = cable(s, r1, 0, sw, 15)
  s = setIp(s, ids.PC1!, 0, '192.168.10.10/24', '192.168.10.254')
  s = setIp(s, ids.PC2!, 0, '192.168.20.10/24', '192.168.20.254')
  s = access(s, sw, 0, 10)
  s = access(s, sw, 1, 20)
  s = unwrap(setSwitchport(s, sw, port(s, sw, 15), { mode: 'trunk' })).state
  if (withRouter)
    for (const vlan of [10, 20]) {
      const sub = unwrap(addSubinterface(s, r1, port(s, r1, 0), vlan))
      s = unwrap(
        setInterfaceIpv4(sub.state, r1, sub.value, {
          addressing: 'static',
          address: `192.168.${vlan}.254`,
          mask: '24',
          gateway: null,
          dnsServers: []
        })
      ).state
    }
  return { s, ids }
}

describe('VLAN : ports d’accès', () => {
  it('deux postes d’un même réseau IP mais de VLAN différents ne se joignent pas', () => {
    const { state, ids } = build([
      ['client', 'PC1'],
      ['client', 'PC2'],
      ['switch', 'SW1']
    ])
    let s = cable(state, ids.PC1!, 0, ids.SW1!, 0)
    s = cable(s, ids.PC2!, 0, ids.SW1!, 1)
    s = setIp(s, ids.PC1!, 0, '192.168.1.10/24')
    s = setIp(s, ids.PC2!, 0, '192.168.1.20/24')
    expect(pingOk(s, ids.PC1!, '192.168.1.20')).toBe(true)
    s = access(s, ids.SW1!, 1, 20)
    expect(pingOk(s, ids.PC1!, '192.168.1.20')).toBe(false)
    // VLAN créé automatiquement à l'affectation du port
    expect((s.devices[ids.SW1!] as SwitchDevice).vlans).toEqual([
      { id: 1, name: 'default' },
      { id: 20, name: 'VLAN0020' }
    ])
    s = access(s, ids.SW1!, 0, 20)
    expect(pingOk(s, ids.PC1!, '192.168.1.20')).toBe(true)
    // VLAN supprimé : ses ports ne transmettent plus
    s = unwrap(removeVlan(s, ids.SW1!, 20)).state
    expect(pingOk(s, ids.PC1!, '192.168.1.20')).toBe(false)
  })
})

describe('VLAN : routage inter-VLAN (routeur « on a stick »)', () => {
  it('acceptation : deux postes de VLAN différents ne communiquent que via le routeur', () => {
    const { s, ids } = onAStick()
    expect(pingOk(s, ids.PC1!, '192.168.20.10')).toBe(true)
    const hops = tracert(s, ids.PC1!, '192.168.20.10')
    expect(hops.ok && hops.value.lines.join('\n')).toContain('192.168.10.254')
    // Sans les sous-interfaces : aucune communication
    const isolated = onAStick(false)
    expect(pingOk(isolated.s, isolated.ids.PC1!, '192.168.20.10')).toBe(false)
    // Sous-interface désactivée ou carte parente arrêtée : plus de routage
    const r1 = s.devices[ids.R1!] as RouterDevice
    const sub20 = r1.interfaces.find((i) => i.name === 'Gi0/0.20')!
    expect(
      pingOk(unwrap(setInterfaceEnabled(s, ids.R1!, sub20.id, false)).state, ids.PC1!, '192.168.20.10')
    ).toBe(false)
    expect(
      pingOk(
        unwrap(setInterfaceEnabled(s, ids.R1!, r1.interfaces[0]!.id, false)).state,
        ids.PC1!,
        '192.168.20.10'
      )
    ).toBe(false)
  })

  it('trames étiquetées 802.1Q sur le trunk, visibles en mode Simulation', () => {
    const { s, ids } = onAStick()
    const r = ping(s, ids.PC1!, '192.168.20.10', { count: 1 })
    if (!r.ok) throw new Error(r.error.message)
    const trunk = Object.values(s.links).find((l) => l.a.deviceId === ids.R1! || l.b.deviceId === ids.R1!)!
    const onTrunk = r.value.trace.events.filter((e) => e.linkId === trunk.id)
    const tags = onTrunk.map(
      (e) => e.layers.find((l) => l.name === '802.1Q')?.fields.find(([k]) => k === 'VLAN')?.[1]
    )
    expect(tags).toContain('10')
    expect(tags).toContain('20')
    expect(tags).not.toContain(undefined)
    // Ports d'accès : trames non étiquetées
    const access = r.value.trace.events.filter((e) => e.linkId !== trunk.id)
    expect(access.every((e) => !e.layers.some((l) => l.name === '802.1Q'))).toBe(true)
    expect(r.value.trace.events.some((e) => e.note.includes('étiquetée 802.1Q VLAN 10'))).toBe(true)
  })

  it('VLAN natif : non étiqueté sur le trunk, reçu par la carte physique du routeur', () => {
    const { s, ids } = onAStick()
    const sw = ids.SW1!
    // VLAN 10 natif sur le trunk : la trame arrive sans étiquette sur Gi0/0, sans adresse → perdue
    let t = unwrap(setSwitchport(s, sw, port(s, sw, 15), { mode: 'trunk', nativeVlan: 10 })).state
    expect(pingOk(t, ids.PC1!, '192.168.20.10')).toBe(false)
    // Adresse de la passerelle sur la carte physique (VLAN natif) au lieu de la sous-interface
    const r1 = t.devices[ids.R1!] as RouterDevice
    t = unwrap(removeSubinterface(t, ids.R1!, r1.interfaces.find((i) => i.name === 'Gi0/0.10')!.id)).state
    t = setIp(t, ids.R1!, 0, '192.168.10.254/24')
    expect(pingOk(t, ids.PC1!, '192.168.20.10')).toBe(true)
  })
})

describe('VLAN : trunk entre deux switchs', () => {
  function twoSwitches() {
    const { state, ids } = build([
      ['client', 'PC1'],
      ['client', 'PC2'],
      ['switch', 'SW1'],
      ['switch', 'SW2']
    ])
    let s = cable(state, ids.PC1!, 0, ids.SW1!, 0)
    s = cable(s, ids.PC2!, 0, ids.SW2!, 0)
    s = cable(s, ids.SW1!, 15, ids.SW2!, 15)
    s = setIp(s, ids.PC1!, 0, '192.168.30.1/24')
    s = setIp(s, ids.PC2!, 0, '192.168.30.2/24')
    s = access(s, ids.SW1!, 0, 30)
    s = access(s, ids.SW2!, 0, 30)
    return { s, ids }
  }

  it('le VLAN doit être autorisé sur le trunk et exister sur chaque switch traversé', () => {
    const { s, ids } = twoSwitches()
    // Liaison en accès (VLAN 1) : le VLAN 30 ne la traverse pas
    expect(pingOk(s, ids.PC1!, '192.168.30.2')).toBe(false)
    let t = s
    for (const sw of [ids.SW1!, ids.SW2!])
      t = unwrap(setSwitchport(t, sw, port(t, sw, 15), { mode: 'trunk' })).state
    expect(pingOk(t, ids.PC1!, '192.168.30.2')).toBe(true)
    // VLAN 30 retiré de la liste autorisée d'un côté
    const restricted = unwrap(
      setSwitchport(t, ids.SW2!, port(t, ids.SW2!, 15), { mode: 'trunk', allowedVlans: [1, 10] })
    ).state
    expect(pingOk(restricted, ids.PC1!, '192.168.30.2')).toBe(false)
    // Trunk d'un côté, accès de l'autre : la trame étiquetée est rejetée par le port d'accès
    const mismatch = unwrap(setSwitchport(t, ids.SW2!, port(t, ids.SW2!, 15), { mode: 'access' })).state
    expect(pingOk(mismatch, ids.PC1!, '192.168.30.2')).toBe(false)
    // Segment de niveau 2 : le chemin porte l'étiquette sur la liaison entre switchs
    const members = l2Segment(t, { deviceId: ids.PC1!, ifaceId: port(t, ids.PC1!, 0) })
    const pc2 = members.find((m) => m.port.deviceId === ids.PC2!)!
    expect(pc2.path.map((h) => h.vlan)).toEqual([undefined, 30, undefined])
  })

  it('un switch intermédiaire sans le VLAN dans sa base ne le transmet pas', () => {
    const { state, ids } = build([
      ['client', 'PC1'],
      ['client', 'PC2'],
      ['switch', 'SW1'],
      ['switch', 'SW2'],
      ['switch', 'SW3']
    ])
    let s = cable(state, ids.PC1!, 0, ids.SW1!, 0)
    s = cable(s, ids.PC2!, 0, ids.SW3!, 0)
    s = cable(s, ids.SW1!, 15, ids.SW2!, 14)
    s = cable(s, ids.SW2!, 15, ids.SW3!, 15)
    s = setIp(s, ids.PC1!, 0, '192.168.30.1/24')
    s = setIp(s, ids.PC2!, 0, '192.168.30.2/24')
    s = access(s, ids.SW1!, 0, 30)
    s = access(s, ids.SW3!, 0, 30)
    for (const [sw, i] of [
      [ids.SW1!, 15],
      [ids.SW2!, 14],
      [ids.SW2!, 15],
      [ids.SW3!, 15]
    ] as const)
      s = unwrap(setSwitchport(s, sw, port(s, sw, i), { mode: 'trunk' })).state
    expect(pingOk(s, ids.PC1!, '192.168.30.2')).toBe(false)
    s = unwrap(addVlan(s, ids.SW2!, 30, 'Transit')).state
    expect(pingOk(s, ids.PC1!, '192.168.30.2')).toBe(true)
  })
})

describe('VLAN : actions et commandes', () => {
  it('base des VLAN : numéros valides, VLAN 1 protégé, noms', () => {
    const { state, ids } = build([['switch', 'SW1']])
    const sw = ids.SW1!
    const err = (r: { ok: boolean; error?: { code: string } }) => (!r.ok ? r.error?.code : 'ok')
    expect(err(addVlan(state, sw, 0))).toBe('InvalidVlan')
    expect(err(addVlan(state, sw, 4095))).toBe('InvalidVlan')
    expect(err(addVlan(state, sw, 1003))).toBe('InvalidVlan')
    expect(err(addVlan(state, sw, 1))).toBe('VlanExists')
    expect(err(addVlan(state, sw, 10, 'Mauvais nom'))).toBe('InvalidName')
    expect(err(removeVlan(state, sw, 1))).toBe('DefaultVlan')
    expect(err(renameVlan(state, sw, 1, 'Autre'))).toBe('DefaultVlan')
    let s = unwrap(addVlan(state, sw, 10)).state
    s = unwrap(renameVlan(s, sw, 10, 'Compta')).state
    expect((s.devices[sw] as SwitchDevice).vlans).toEqual([
      { id: 1, name: 'default' },
      { id: 10, name: 'Compta' }
    ])
    expect(err(removeVlan(s, sw, 99))).toBe('VlanNotFound')
    // Port remis en accès VLAN 1 : configuration par défaut (aucune donnée enregistrée)
    s = access(s, sw, 0, 10)
    expect(s.devices[sw]!.interfaces[0]!.switchport?.accessVlan).toBe(10)
    s = access(s, sw, 0, 1)
    expect(s.devices[sw]!.interfaces[0]!.switchport).toBeUndefined()
  })

  it('sous-interfaces : routeur seulement, VLAN unique par carte, jamais câblées', () => {
    const { state, ids } = build([
      ['router', 'R1'],
      ['switch', 'SW1'],
      ['client', 'PC1']
    ])
    const r1 = ids.R1!
    const gi0 = port(state, r1, 0)
    expect(addSubinterface(state, ids.SW1!, port(state, ids.SW1!, 0), 10).ok).toBe(false)
    const sub = unwrap(addSubinterface(state, r1, gi0, 10))
    const s = sub.state
    const created = s.devices[r1]!.interfaces.find((i) => i.id === sub.value)!
    expect(created.name).toBe('Gi0/0.10')
    expect(created.mac).toBe(s.devices[r1]!.interfaces[0]!.mac)
    expect(s.devices[r1]!.interfaces[1]!.name).toBe('Gi0/0.10')
    const dup = addSubinterface(s, r1, gi0, 10)
    expect(!dup.ok && dup.error.code).toBe('VlanExists')
    const plug = connect(
      s,
      { deviceId: r1, ifaceId: sub.value },
      { deviceId: ids.PC1!, ifaceId: port(s, ids.PC1!, 0) }
    )
    expect(!plug.ok && plug.error.code).toBe('Subinterface')
  })

  it('copier-coller : base des VLAN, ports et sous-interfaces recopiés', () => {
    const { s, ids } = onAStick()
    const r = unwrap(
      duplicateDevices(
        s,
        { devices: [s.devices[ids.SW1!]!, s.devices[ids.R1!]!], links: [] },
        { x: 50, y: 50 }
      )
    )
    const [swCopy, rCopy] = r.value.map((id) => r.state.devices[id]!)
    expect((swCopy as SwitchDevice).vlans.map((v) => v.id)).toEqual([1, 10, 20])
    expect(swCopy!.interfaces[15]!.switchport?.mode).toBe('trunk')
    const sub = rCopy!.interfaces.find((i) => i.name === 'Gi0/0.10')!
    expect(sub.subinterface?.parent).toBe(rCopy!.interfaces[0]!.id)
    expect(sub.mac).toBe(rCopy!.interfaces[0]!.mac)
  })

  it('commandes nommées : libellés français', () => {
    const { state, ids } = build([
      ['switch', 'SW1'],
      ['router', 'R1']
    ])
    const r = dispatch(
      state,
      command('net.setSwitchport', ids.SW1!, port(state, ids.SW1!, 0), { mode: 'trunk' })
    )
    expect(r.ok && r.entry?.label).toBe('Configurer SW1 Fa0/1 en trunk 802.1Q')
    const sub = dispatch(state, command('net.addSubinterface', ids.R1!, port(state, ids.R1!, 0), 10))
    expect(sub.ok && sub.entry?.label).toBe('Créer la sous-interface R1 Gi0/0.10')
  })
})
