import { describe, expect, it } from 'vitest'
import {
  addServerInterface,
  connect,
  createLab,
  disconnect,
  duplicateDevices,
  endStatus,
  linkStatus,
  removeDevices,
  renameDevice,
  setInterfaceEnabled,
  setPower,
  unwrap
} from '@engine/index'
import { add, cable } from '../helpers'

describe('ajout d’équipements', () => {
  it('nomme automatiquement les équipements par type', () => {
    let s = createLab()
    let r = add(s, 'server')
    s = r.state
    expect(s.devices[r.id]?.name).toBe('SRV1')
    r = add(s, 'server')
    s = r.state
    expect(s.devices[r.id]?.name).toBe('SRV2')
    r = add(s, 'client')
    expect(r.state.devices[r.id]?.name).toBe('PC1')
  })

  it('crée les ports attendus selon le type', () => {
    let s = createLab()
    const sw = add(s, 'switch')
    s = sw.state
    const r = add(s, 'router')
    s = r.state
    expect(s.devices[sw.id]?.interfaces).toHaveLength(16)
    expect(s.devices[sw.id]?.interfaces.every((i) => !i.l3)).toBe(true)
    expect(s.devices[r.id]?.interfaces.map((i) => i.name)).toEqual(['Eth0', 'Eth1', 'Eth2', 'Eth3'])
  })

  it('génère des MAC uniques et déterministes', () => {
    let s = createLab()
    s = add(s, 'switch').state
    s = add(s, 'router').state
    const macs = Object.values(s.devices).flatMap((d) => d.interfaces.map((i) => i.mac))
    expect(new Set(macs).size).toBe(macs.length)
    expect(macs[0]).toMatch(/^02-53-4C-[0-9A-F]{2}-[0-9A-F]{2}-[0-9A-F]{2}$/)
  })

  it('met les postes et serveurs en DHCP par défaut', () => {
    const r = add(createLab(), 'client')
    expect(r.state.devices[r.id]?.interfaces[0]?.addressing).toBe('dhcp')
  })

  it('ne modifie jamais l’état d’origine', () => {
    const s = createLab()
    add(s, 'server')
    expect(Object.keys(s.devices)).toHaveLength(0)
  })
})

describe('renommage', () => {
  it('applique les règles NetBIOS aux serveurs', () => {
    const r = add(createLab(), 'server')
    expect(renameDevice(r.state, r.id, 'NOM-BEAUCOUP-TROP-LONG').ok).toBe(false)
    expect(renameDevice(r.state, r.id, 'SRV_AD').ok).toBe(false)
    expect(renameDevice(r.state, r.id, '1234').ok).toBe(false)
    expect(renameDevice(r.state, r.id, 'SRV-AD01').ok).toBe(true)
  })

  it('refuse les doublons (insensible à la casse)', () => {
    let s = createLab()
    s = add(s, 'server').state
    const pc = add(s, 'client')
    const res = renameDevice(pc.state, pc.id, 'srv1')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('DuplicateName')
  })
})

describe('câblage', () => {
  it('relie deux ports libres puis refuse un port déjà utilisé', () => {
    let s = createLab()
    const a = add(s, 'client')
    s = a.state
    const b = add(s, 'switch')
    s = cable(b.state, a.id, 0, b.id, 0)
    expect(Object.keys(s.links)).toHaveLength(1)
    const pcPort = s.devices[a.id]!.interfaces[0]!.id
    const swPort = s.devices[b.id]!.interfaces[1]!.id
    const again = connect(s, { deviceId: a.id, ifaceId: pcPort }, { deviceId: b.id, ifaceId: swPort })
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.error.message).toContain('déjà utilisé')
  })

  it('refuse de relier un équipement à lui-même', () => {
    const sw = add(createLab(), 'switch')
    const d = sw.state.devices[sw.id]!
    const r = connect(
      sw.state,
      { deviceId: sw.id, ifaceId: d.interfaces[0]!.id },
      { deviceId: sw.id, ifaceId: d.interfaces[1]!.id }
    )
    expect(r.ok).toBe(false)
  })

  it('supprime les câbles avec l’équipement', () => {
    let s = createLab()
    const a = add(s, 'client')
    const b = add(a.state, 'switch')
    s = cable(b.state, a.id, 0, b.id, 0)
    s = unwrap(removeDevices(s, [a.id])).state
    expect(Object.keys(s.links)).toHaveLength(0)
    expect(s.devices[a.id]).toBeUndefined()
  })

  it('débranche un câble', () => {
    const a = add(createLab(), 'client')
    const b = add(a.state, 'switch')
    const s = cable(b.state, a.id, 0, b.id, 0)
    const linkId = Object.keys(s.links)[0]!
    expect(Object.keys(unwrap(disconnect(s, linkId)).state.links)).toHaveLength(0)
  })
})

describe('voyants des liens', () => {
  it('vert entre deux switchs, orange pour un poste sans IP, rouge si éteint', () => {
    let s = createLab()
    const sw1 = add(s, 'switch')
    const sw2 = add(sw1.state, 'switch')
    const pc = add(sw2.state, 'client')
    s = cable(pc.state, sw1.id, 0, sw2.id, 0)
    s = cable(s, pc.id, 0, sw1.id, 1)
    const [swLink, pcLink] = Object.values(s.links)
    expect(linkStatus(s, swLink!)).toBe('up')
    // Le poste est en DHCP sans serveur → APIPA → orange côté poste, vert côté switch
    expect(endStatus(s, pcLink!, 'a')).toBe('degraded')
    expect(endStatus(s, pcLink!, 'b')).toBe('up')
    s = unwrap(setPower(s, pc.id, false)).state
    expect(linkStatus(s, pcLink!)).toBe('down')
  })

  it('rouge si le port est désactivé', () => {
    const sw1 = add(createLab(), 'switch')
    const sw2 = add(sw1.state, 'switch')
    let s = cable(sw2.state, sw1.id, 0, sw2.id, 0)
    s = unwrap(setInterfaceEnabled(s, sw1.id, s.devices[sw1.id]!.interfaces[0]!.id, false)).state
    expect(linkStatus(s, Object.values(s.links)[0]!)).toBe('down')
  })
})

describe('cartes réseau supplémentaires', () => {
  it('limite un serveur à 4 cartes', () => {
    const created = add(createLab(), 'server')
    const id = created.id
    let s = created.state
    for (let i = 0; i < 3; i++) s = unwrap(addServerInterface(s, id)).state
    expect(s.devices[id]!.interfaces.map((i) => i.name)).toEqual([
      'Ethernet0',
      'Ethernet1',
      'Ethernet2',
      'Ethernet3'
    ])
    expect(addServerInterface(s, id).ok).toBe(false)
  })
})

describe('copier / coller', () => {
  it('duplique équipements et câbles internes avec de nouvelles identités', () => {
    const a = add(createLab(), 'client')
    const b = add(a.state, 'switch')
    const s = cable(b.state, a.id, 0, b.id, 0)
    const source = { devices: [s.devices[a.id]!, s.devices[b.id]!], links: Object.values(s.links) }
    const r = unwrap(duplicateDevices(s, source, { x: 40, y: 40 }))
    expect(r.value).toHaveLength(2)
    expect(Object.keys(r.state.links)).toHaveLength(2)
    const names = Object.values(r.state.devices)
      .map((d) => d.name)
      .sort()
    expect(names).toEqual(['PC1', 'PC2', 'SW1', 'SW2'])
    const macs = Object.values(r.state.devices).flatMap((d) => d.interfaces.map((i) => i.mac))
    expect(new Set(macs).size).toBe(macs.length)
  })
})
