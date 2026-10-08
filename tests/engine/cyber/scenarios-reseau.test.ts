/**
 * Scénarios « réseau » sur une topologie Cisco de la v2.5 : sans contre-mesure ils réussissent,
 * avec les commandes IOS de durcissement (inspection ARP, nonegotiate, VLAN natif dédié) ils échouent.
 */
import { describe, expect, it } from 'vitest'
import { command, dispatch, l2Segment, ping, type LabState } from '@engine/index'
import { add, cable, createLab, setIp } from '../helpers'
import { addIos, IosConsole, type SharedLab } from '../ios/helpers'

const id = (s: LabState, name: string) => Object.values(s.devices).find((d) => d.name === name)!.id
const nic = (s: LabState, name: string) => s.devices[id(s, name)]!.interfaces[0]!

/**
 * SW1 (2960) : PC1 (.10) Fa0/1 et PC2 (.20) Fa0/2 victimes, PC3 (.66) Fa0/3 agresseur, tous en
 * VLAN 10 ; le VLAN 20 existe. Les trois hôtes sont désignés dans les données `cyber` du lab.
 */
function topology(): { lab: SharedLab; sw: IosConsole } {
  const sw = addIos(createLab(), 'c2960', 'SW1')
  let s = sw.state
  const hosts = ['PC1', 'PC2', 'PC3'].map((name) => {
    const h = add(s, 'client', name)
    s = h.state
    return h.id
  })
  hosts.forEach((h, i) => {
    s = cable(s, h, 0, sw.id, i)
    s = setIp(s, h, 0, `192.168.10.${[10, 20, 66][i]}/24`)
  })
  const lab: SharedLab = { state: s }
  const console = new IosConsole(lab, sw.id)
  console.lines('en', 'conf t', 'vlan 10', 'exit', 'vlan 20', 'exit')
  for (const port of ['Fa0/1', 'Fa0/2', 'Fa0/3'])
    console.lines(`int ${port}`, 'switchport mode access', 'switchport access vlan 10', 'exit')
  console.lines('end')
  lab.state = {
    ...lab.state,
    cyber: {
      ...lab.state.cyber,
      arpSpoof: { attacker: 'PC3', victimA: 'PC1', victimB: 'PC2' },
      vlanHop: { attacker: 'PC3', toVlan: 20 }
    }
  }
  return { lab, sw: console }
}

/** Joue l'unique étape d'un scénario par la commande nommée. */
function play(s: LabState, scenario: string) {
  const r = dispatch(s, command('cyber.playStep', scenario, 0))
  if (!r.ok) throw new Error(r.error.message)
  const record = r.value as { success: boolean; trace?: { events: { outcome: string; note: string }[] } }
  return { state: r.state, record }
}

/** Le ping de PC3 vers PC1 aboutit-il ? */
const reaches = (s: LabState): boolean => {
  const r = ping(s, id(s, 'PC3'), '192.168.10.10')
  return r.ok && r.value.success
}

const logging = (lab: SharedLab, sw: IosConsole) => {
  void lab
  return sw.run('show logging').join('\n')
}

describe('1. usurpation d’adresse sur le segment', () => {
  it('sans inspection ARP : trafic A ↔ B marqué intercepté par l’agresseur, conflit d’adresse journalisé', () => {
    const { lab } = topology()
    const { state, record } = play(lab.state, 'usurpation-arp')
    expect(record.success).toBe(true)
    expect(state.cyber.intercepts).toEqual([
      { a: id(state, 'PC1'), b: id(state, 'PC2'), by: id(state, 'PC3') }
    ])
    const log = (
      state.devices[id(state, 'PC1')] as { host: { eventLog: { eventId: number; message: string }[] } }
    ).host.eventLog
    expect(log.at(-1)).toMatchObject({ eventId: 4199 })
    expect(log.at(-1)!.message).toContain(nic(state, 'PC3').mac)
    // Visible en Simulation : l'annonce est livrée à la victime
    expect(record.trace!.events.at(-1)).toMatchObject({ outcome: 'delivered' })
  })

  it('avec inspection ARP : l’annonce est rejetée, rien n’est marqué, blocage dans le journal du switch', () => {
    const { lab, sw } = topology()
    sw.lines(
      'en',
      'conf t',
      'ip dhcp snooping',
      'ip dhcp snooping vlan 10',
      'ip arp inspection vlan 10',
      'end'
    )
    const { state, record } = play(lab.state, 'usurpation-arp')
    expect(record.success).toBe(false)
    expect(state.cyber.intercepts).toEqual([])
    expect(record.trace!.events.at(-1)).toMatchObject({ outcome: 'dropped' })
    expect(record.trace!.events.at(-1)!.note).toContain('inspection ARP')
    lab.state = state
    const text = logging(lab, sw)
    expect(text).toContain('%SW_DAI-4-DHCP_SNOOPING_DENY')
    expect(text).toContain('vlan 10')
  })

  it('hôtes sur des segments différents : rien ne se passe', () => {
    const { lab, sw } = topology()
    sw.lines('en', 'conf t', 'int Fa0/3', 'switchport access vlan 20', 'end')
    const { state, record } = play(lab.state, 'usurpation-arp')
    expect(record.success).toBe(false)
    expect(state.cyber.intercepts).toEqual([])
  })
})

describe('2. changement de VLAN non autorisé', () => {
  it('négociation de trunk conservée, VLAN natif par défaut : l’hôte change de VLAN sans reconfiguration du port', () => {
    const { lab, sw } = topology()
    const { state, record } = play(lab.state, 'saut-de-vlan')
    expect(record.success).toBe(true)
    const port = state.devices[id(state, 'SW1')]!.interfaces.find((p) => p.name === 'Fa0/3')!
    // La configuration du port n'a pas changé : c'est l'état simulé qui porte le saut
    expect(port.switchport).toMatchObject({ mode: 'access', accessVlan: 10, hoppedVlan: 20 })
    lab.state = state
    expect(sw.run('show running-config').join('\n')).not.toContain('switchport access vlan 20')
    // L'hôte est maintenant dans le VLAN 20 : il ne voit plus ses anciens voisins
    const members = l2Segment(state, { deviceId: id(state, 'PC3'), ifaceId: nic(state, 'PC3').id })
    expect(members.map((m) => m.port.deviceId)).not.toContain(id(state, 'PC1'))
    expect(reaches(state)).toBe(false)
    expect(logging(lab, sw)).toContain('%DTP-5-TRUNKPORTON')
    expect(record.trace!.events[0]).toMatchObject({ protocol: 'DTP', outcome: 'delivered' })
  })

  it.each([
    ['switchport nonegotiate', 'négociation désactivée'],
    ['switchport trunk native vlan 99', 'VLAN natif dédié']
  ])('avec « %s » (%s) : le port refuse, blocage journalisé', (line) => {
    const { lab, sw } = topology()
    sw.lines('en', 'conf t', 'vlan 99', 'exit', 'int Fa0/3', line, 'end')
    const { state, record } = play(lab.state, 'saut-de-vlan')
    expect(record.success).toBe(false)
    const port = state.devices[id(state, 'SW1')]!.interfaces.find((p) => p.name === 'Fa0/3')!
    expect(port.switchport?.hoppedVlan ?? null).toBeNull()
    expect(record.trace!.events[0]).toMatchObject({ outcome: 'dropped' })
    lab.state = state
    expect(logging(lab, sw)).toContain('%L2SEC-4-VLAN_CHANGE_DENIED')
    expect(reaches(state)).toBe(true)
  })

  it('VLAN visé inexistant : rien ne se passe', () => {
    const { lab } = topology()
    const s = { ...lab.state, cyber: { ...lab.state.cyber, vlanHop: { attacker: 'PC3', toVlan: 77 } } }
    expect(play(s, 'saut-de-vlan').record.success).toBe(false)
  })
})

describe('critère d’acceptation : topologie sans contre-mesure contre topologie durcie', () => {
  const both = (s: LabState) => [
    play(s, 'usurpation-arp').record.success,
    play(s, 'saut-de-vlan').record.success
  ]

  it('sans contre-mesure, les deux scénarios réussissent', () => {
    expect(both(topology().lab.state)).toEqual([true, true])
  })

  it('avec les commandes de durcissement, les deux échouent', () => {
    const { lab, sw } = topology()
    sw.lines(
      'en',
      'conf t',
      'ip dhcp snooping',
      'ip dhcp snooping vlan 10',
      'ip arp inspection vlan 10',
      'int Fa0/3',
      'switchport nonegotiate',
      'end'
    )
    expect(both(lab.state)).toEqual([false, false])
  })
})
