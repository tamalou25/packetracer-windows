/**
 * Équipements Cisco IOS : création (modèle, ports d'usine), câblage sur le moteur réseau existant,
 * copie, enregistrement dans un .slab et ouverture de la console IOS.
 */
import { describe, expect, it } from 'vitest'
import {
  addDevice,
  connect,
  createLab,
  createShellSession,
  duplicateDevices,
  executeLine,
  ifaceLongName,
  IOS_MODELS,
  isIosDevice,
  parseSlab,
  serializeSlab,
  shellPrompt,
  unwrap,
  type IosModel,
  type LabState
} from '@engine/index'

function addIos(
  state: LabState,
  model: IosModel,
  kind: 'router' | 'switch'
): { state: LabState; id: string } {
  const r = unwrap(addDevice(state, { kind, model, position: { x: 0, y: 0 } }))
  return { state: r.state, id: r.value }
}

const ports = (state: LabState, id: string) => state.devices[id]?.interfaces.map((i) => i.name)

describe('nœuds Cisco IOS', () => {
  it('chaque modèle a ses ports d’usine', () => {
    const r1 = addIos(createLab(), 'c1921', 'router')
    const r2 = addIos(r1.state, 'c2811', 'router')
    const sw1 = addIos(r2.state, 'c2960', 'switch')
    const sw2 = addIos(sw1.state, 'c9200', 'switch')
    const s = sw2.state
    expect(ports(s, r1.id)).toEqual(['Gi0/0', 'Gi0/1'])
    expect(ports(s, r2.id)).toEqual(['Fa0/0', 'Fa0/1'])
    expect(ports(s, sw1.id)).toHaveLength(26)
    expect(ports(s, sw1.id)?.slice(-3)).toEqual(['Fa0/24', 'Gi0/1', 'Gi0/2'])
    expect(ports(s, sw2.id)).toHaveLength(24)
    expect(ports(s, sw2.id)?.[0]).toBe('Gi1/0/1')
    // Ports de switch de niveau 2, interfaces de routeur de niveau 3
    expect(s.devices[sw1.id]?.interfaces.every((i) => !i.l3)).toBe(true)
    expect(s.devices[r1.id]?.interfaces.every((i) => i.l3)).toBe(true)
    expect(s.devices[r1.id]?.name).toBe('R1')
    expect(s.devices[sw2.id]?.name).toBe('SW2')
  })

  it('refuse un modèle d’un autre type d’équipement', () => {
    const r = addDevice(createLab(), { kind: 'router', model: 'c2960', position: { x: 0, y: 0 } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('InvalidModel')
  })

  it('les équipements génériques restent sans modèle', () => {
    const r = unwrap(addDevice(createLab(), { kind: 'router', position: { x: 0, y: 0 } }))
    const d = r.state.devices[r.value]
    expect(d?.kind === 'router' && d.model).toBeUndefined()
    expect(isIosDevice(r.state, r.value)).toBe(false)
    expect(d?.interfaces).toHaveLength(4)
  })

  it('se câblent comme les autres équipements', () => {
    const r = addIos(createLab(), 'c1921', 'router')
    const sw = addIos(r.state, 'c2960', 'switch')
    const s = unwrap(
      connect(
        sw.state,
        { deviceId: r.id, ifaceId: sw.state.devices[r.id]?.interfaces[0]?.id ?? '' },
        { deviceId: sw.id, ifaceId: sw.state.devices[sw.id]?.interfaces[24]?.id ?? '' }
      )
    ).state
    expect(Object.keys(s.links)).toHaveLength(1)
  })

  it('une copie garde le modèle', () => {
    const sw = addIos(createLab(), 'c9200', 'switch')
    const device = sw.state.devices[sw.id]
    if (!device) throw new Error('absent')
    const r = unwrap(duplicateDevices(sw.state, { devices: [device], links: [] }, { x: 40, y: 40 }))
    const copy = r.state.devices[r.value[0] ?? '']
    expect(copy?.kind === 'switch' && copy.model).toBe('c9200')
    expect(copy?.interfaces).toHaveLength(24)
  })

  it('s’enregistrent et se rouvrent dans un .slab', () => {
    let s = createLab()
    const ids: string[] = []
    for (const model of IOS_MODELS) {
      const r = addIos(s, model, model.startsWith('c29') || model.startsWith('c92') ? 'switch' : 'router')
      s = r.state
      ids.push(r.id)
    }
    const parsed = parseSlab(serializeSlab(s, { appVersion: '2.5.0', savedAt: '2026-10-08T00:00:00Z' }))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const models = ids.map((id) => {
      const d = parsed.doc.lab.devices[id]
      return d?.kind === 'router' || d?.kind === 'switch' ? d.model : null
    })
    expect(models).toEqual([...IOS_MODELS])
    expect(parsed.doc.lab).toEqual(s)
  })
})

describe('console IOS', () => {
  it('s’ouvre en mode utilisateur avec le nom de l’équipement', () => {
    const r = addIos(createLab(), 'c1921', 'router')
    const session = createShellSession(r.state, r.id, 'cmd')
    expect(session.stack).toEqual(['ios'])
    expect(shellPrompt(session, r.state)).toBe('R1>')
  })

  it('un mot inconnu est pris pour un nom d’hôte', () => {
    const r = addIos(createLab(), 'c2960', 'switch')
    const session = createShellSession(r.state, r.id, 'ios')
    const res = executeLine(r.state, session, 'foo')
    expect(res.output.map((l) => l.text)).toEqual([
      'Translating "foo"...domain server (255.255.255.255)',
      '% Unknown command or computer name, or unable to find computer address'
    ])
    expect(res.state).toBe(r.state)
  })

  it('noms longs des interfaces', () => {
    expect(ifaceLongName('Gi0/0')).toBe('GigabitEthernet0/0')
    expect(ifaceLongName('Fa0/24')).toBe('FastEthernet0/24')
    expect(ifaceLongName('Gi1/0/1')).toBe('GigabitEthernet1/0/1')
    expect(ifaceLongName('Gi0/0.10')).toBe('GigabitEthernet0/0.10')
  })
})
