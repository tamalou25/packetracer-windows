/**
 * Switching et VLAN IOS : base des VLAN, ports d'accès et trunks, router-on-a-stick, inter-VLAN
 * de niveau 3 (SVI) sur un 9200. Les pings passent par le moteur réseau existant.
 */
import { describe, expect, it } from 'vitest'
import { ping, type LabState } from '@engine/index'
import { add, cable, createLab, setIp } from '../helpers'
import { addIos, IosConsole, type SharedLab } from './helpers'

function pingOk(state: LabState, from: string, to: string): boolean {
  const r = ping(state, from, to)
  return r.ok && r.value.success
}

/** R1 (1921) Gi0/0 ↔ SW1 (2960) Gi0/1 ; PC1 ↔ Fa0/1 ; PC2 ↔ Fa0/2. */
function routerOnAStick() {
  const r1 = addIos(createLab(), 'c1921')
  const sw = addIos(r1.state, 'c2960')
  const pc1 = add(sw.state, 'client')
  const pc2 = add(pc1.state, 'client')
  let s = cable(pc2.state, r1.id, 0, sw.id, 24)
  s = cable(s, pc1.id, 0, sw.id, 0)
  s = cable(s, pc2.id, 0, sw.id, 1)
  s = setIp(s, pc1.id, 0, '192.168.10.10/24', '192.168.10.1')
  s = setIp(s, pc2.id, 0, '192.168.20.10/24', '192.168.20.1')
  const lab: SharedLab = { state: s }
  return { lab, r1: new IosConsole(lab, r1.id), sw: new IosConsole(lab, sw.id), pc1: pc1.id, pc2: pc2.id }
}

function configureSwitch(sw: IosConsole): void {
  sw.lines(
    'en',
    'conf t',
    'vlan 10',
    'name COMPTA',
    'vlan 20',
    'name RH',
    'exit',
    'int fa0/1',
    'switchport mode access',
    'switchport access vlan 10',
    'int fa0/2',
    'switchport mode access',
    'switchport access vlan 20',
    'int g0/1',
    'switchport mode trunk',
    'end'
  )
}

describe('base des VLAN et ports', () => {
  it('vlan, name, show vlan brief', () => {
    const { sw } = routerOnAStick()
    configureSwitch(sw)
    const out = sw.run('show vlan brief')
    expect(out.slice(1, 3)).toEqual([
      'VLAN Name                             Status    Ports',
      '---- -------------------------------- --------- -------------------------------'
    ])
    expect(out[3]).toBe('1    default                          active    Fa0/3, Fa0/4, Fa0/5, Fa0/6')
    expect(out[4]).toBe(`${' '.repeat(48)}Fa0/7, Fa0/8, Fa0/9, Fa0/10`)
    expect(out).toContain('10   COMPTA                           active    Fa0/1')
    expect(out).toContain('20   RH                               active    Fa0/2')
    expect(out).toContain('1002 fddi-default                     act/unsup')
    // Gi0/1 (trunk) n'apparaît dans aucun VLAN
    expect(out.join('\n')).not.toContain('Gi0/1')
  })

  it('switchport access vlan crée un VLAN absent', () => {
    const { sw } = routerOnAStick()
    sw.lines('en', 'conf t', 'int fa0/5')
    expect(sw.run('switchport access vlan 30')).toEqual(['% Access VLAN does not exist. Creating vlan 30'])
    expect(sw.lines('end', 'show vlan brief')).toContain(
      '30   VLAN0030                         active    Fa0/5'
    )
  })

  it('no vlan ; le VLAN 1 ne se supprime pas', () => {
    const { sw } = routerOnAStick()
    sw.lines('en', 'conf t', 'vlan 40', 'exit')
    expect(sw.run('no vlan 1')).toEqual(['%Default VLAN 1 may not be deleted.'])
    sw.run('no vlan 40')
    expect(sw.lines('end', 'show vlan brief').some((l) => l.startsWith('40 '))).toBe(false)
  })

  it('trunk : allowed, native, show interfaces trunk, running-config', () => {
    const { sw, r1 } = routerOnAStick()
    configureSwitch(sw)
    // Le trunk ne s'affiche que s'il est actif : interface du routeur activée
    r1.lines('en', 'conf t', 'int g0/0', 'no shut', 'end')
    sw.lines(
      'conf t',
      'int g0/1',
      'switchport trunk allowed vlan 10,20',
      'switchport trunk allowed vlan add 30-32'
    )
    sw.lines('switchport trunk native vlan 99', 'end')
    const out = sw.run('show interfaces trunk')
    expect(out).toContain('Gi0/1       on               802.1q         trunking      99')
    expect(out).toContain('Gi0/1       10,20,30-32')
    expect(out).toContain('Gi0/1       10,20')
    const run = sw.run('show running-config')
    const at = run.indexOf('interface GigabitEthernet0/1')
    expect(run.slice(at, at + 5)).toEqual([
      'interface GigabitEthernet0/1',
      ' switchport trunk native vlan 99',
      ' switchport trunk allowed vlan 10,20,30-32',
      ' switchport mode trunk',
      '!'
    ])
    sw.lines(
      'conf t',
      'int g0/1',
      'switchport trunk allowed vlan remove 30-32',
      'no switchport trunk native vlan',
      'end'
    )
    expect(sw.run('show interfaces trunk')).toContain(
      'Gi0/1       on               802.1q         trunking      1'
    )
  })

  it('pas de switchport sur un routeur, pas d’ip routing sur un 2960', () => {
    const { sw, r1 } = routerOnAStick()
    r1.lines('en', 'conf t', 'int g0/0')
    expect(r1.run('switchport mode access')[1]).toBe("% Invalid input detected at '^' marker.")
    sw.lines('en', 'conf t')
    expect(sw.run('ip routing')[1]).toBe("% Invalid input detected at '^' marker.")
  })
})

describe('router-on-a-stick', () => {
  it('deux postes de VLAN différents se pinguent via les sous-interfaces', () => {
    const { lab, r1, sw, pc1, pc2 } = routerOnAStick()
    configureSwitch(sw)
    r1.lines('en', 'conf t', 'int g0/0', 'no shut', 'int g0/0.10', 'encapsulation dot1Q 10')
    r1.lines('ip address 192.168.10.1 255.255.255.0', 'int g0/0.20', 'encapsulation dot1Q 20')
    expect(pingOk(lab.state, pc1, '192.168.20.10')).toBe(false)
    r1.lines('ip address 192.168.20.1 255.255.255.0', 'end')
    expect(pingOk(lab.state, pc1, '192.168.20.10')).toBe(true)
    expect(pingOk(lab.state, pc2, '192.168.10.10')).toBe(true)
    const run = r1.run('show running-config')
    const at = run.indexOf('interface GigabitEthernet0/0.10')
    expect(run.slice(at, at + 3)).toEqual([
      'interface GigabitEthernet0/0.10',
      ' encapsulation dot1Q 10',
      ' ip address 192.168.10.1 255.255.255.0'
    ])
  })

  it('même VID deux fois sur une même interface : refusé', () => {
    const { r1 } = routerOnAStick()
    r1.lines('en', 'conf t', 'int g0/0.10', 'encapsulation dot1Q 10', 'int g0/0.11')
    expect(r1.run('encapsulation dot1Q 10')[1]).toBe(
      'This VID is already configured on GigabitEthernet0/0.10.'
    )
  })

  it('le trunk retiré, le ping échoue', () => {
    const { lab, r1, sw, pc1 } = routerOnAStick()
    configureSwitch(sw)
    r1.lines('en', 'conf t', 'int g0/0', 'no shut', 'int g0/0.10', 'encapsulation dot1Q 10')
    r1.lines('ip address 192.168.10.1 255.255.255.0', 'int g0/0.20', 'encapsulation dot1Q 20')
    r1.lines('ip address 192.168.20.1 255.255.255.0', 'end')
    sw.lines('conf t', 'int g0/1', 'switchport trunk allowed vlan 10', 'end')
    expect(pingOk(lab.state, pc1, '192.168.20.10')).toBe(false)
  })
})

describe('inter-VLAN de niveau 3 sur un 9200', () => {
  function l3Switch() {
    const sw = addIos(createLab(), 'c9200')
    const pc1 = add(sw.state, 'client')
    const pc2 = add(pc1.state, 'client')
    let s = cable(pc2.state, pc1.id, 0, sw.id, 0)
    s = cable(s, pc2.id, 0, sw.id, 1)
    s = setIp(s, pc1.id, 0, '192.168.10.10/24', '192.168.10.1')
    s = setIp(s, pc2.id, 0, '192.168.20.10/24', '192.168.20.1')
    const lab: SharedLab = { state: s }
    const c = new IosConsole(lab, sw.id)
    c.lines('en', 'conf t', 'vlan 10', 'vlan 20', 'exit')
    c.lines('int g1/0/1', 'switchport mode access', 'switchport access vlan 10')
    c.lines('int g1/0/2', 'switchport mode access', 'switchport access vlan 20')
    c.lines('int vlan 10', 'ip address 192.168.10.1 255.255.255.0')
    c.lines('int vlan 20', 'ip address 192.168.20.1 255.255.255.0', 'end')
    return { lab, c, pc1: pc1.id }
  }

  it('les SVI répondent, le routage exige ip routing', () => {
    const { lab, c, pc1 } = l3Switch()
    expect(pingOk(lab.state, pc1, '192.168.10.1')).toBe(true)
    expect(pingOk(lab.state, pc1, '192.168.20.10')).toBe(false)
    c.lines('conf t', 'ip routing', 'end')
    expect(pingOk(lab.state, pc1, '192.168.20.10')).toBe(true)
    expect(c.run('show running-config')).toContain('ip routing')
    expect(c.run('show ip interface brief')).toContain(
      'Vlan10                 192.168.10.1    YES manual up                    up'
    )
  })

  it('interface VLAN sans port actif : down/down ; no interface vlan la supprime', () => {
    const { c } = l3Switch()
    c.lines('conf t', 'int vlan 30', 'ip address 10.0.30.1 255.255.255.0', 'end')
    expect(c.run('show ip interface brief')).toContain(
      'Vlan30                 10.0.30.1       YES manual down                  down'
    )
    c.lines('conf t', 'no interface vlan 30', 'end')
    expect(c.run('show ip interface brief').some((l) => l.startsWith('Vlan30'))).toBe(false)
  })

  it('reload : SVI restaurées depuis la startup-config, base des VLAN conservée', () => {
    const { lab, c, pc1 } = l3Switch()
    c.lines('conf t', 'ip routing', 'end')
    c.run('copy running-config startup-config', [''])
    c.run('reload', [''])
    expect(pingOk(lab.state, pc1, '192.168.20.10')).toBe(true)
    c.lines('en', 'conf t', 'vlan 50', 'end')
    c.run('reload', ['no', ''])
    expect(c.lines('en', 'show vlan brief').some((l) => l.startsWith('50 '))).toBe(true)
  })
})
