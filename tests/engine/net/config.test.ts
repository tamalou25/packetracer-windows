import { describe, expect, it } from 'vitest'
import { addStaticRoute, endStatus, ipConflicts, setInterfaceIpv4, setPower, unwrap } from '@engine/index'
import { build, cable, setIp } from '../helpers'

describe('configuration IP', () => {
  it('valide adresse, masque et passerelle', () => {
    const { state, ids } = build([['client', 'PC1']])
    const iface = state.devices[ids.PC1!]!.interfaces[0]!.id
    const set = (address: string, mask: string, gateway?: string) =>
      setInterfaceIpv4(state, ids.PC1!, iface, {
        addressing: 'static',
        address,
        mask,
        gateway: gateway ?? null
      })
    expect(set('192.168.1.300', '24').ok).toBe(false)
    expect(set('192.168.1.10', '255.0.255.0').ok).toBe(false)
    expect(set('192.168.1.0', '24').ok).toBe(false)
    expect(set('192.168.1.10', '24', '192.168.1.10').ok).toBe(false)
    const warn = set('192.168.1.10', '24', '10.0.0.1')
    expect(warn.ok && warn.value.warnings[0]).toContain('pas sur le même segment')
    const ok = unwrap(set('192.168.1.10', '255.255.255.0', '192.168.1.254'))
    const cfg = ok.state.devices[ids.PC1!]!.interfaces[0]!
    expect(cfg.prefixLength).toBe(24)
    expect(cfg.dnsMode).toBe('static')
  })

  it('refuse le DHCP sur un routeur et les réseaux qui se chevauchent', () => {
    const { state, ids } = build([['router', 'R1']])
    const r = state.devices[ids.R1!]!
    expect(setInterfaceIpv4(state, ids.R1!, r.interfaces[0]!.id, { addressing: 'dhcp' }).ok).toBe(false)
    const s = setIp(state, ids.R1!, 0, '192.168.1.254/24')
    const overlap = setInterfaceIpv4(s, ids.R1!, r.interfaces[1]!.id, {
      addressing: 'static',
      address: '192.168.1.1',
      mask: '24'
    })
    expect(overlap.ok).toBe(false)
    if (!overlap.ok) expect(overlap.error.message).toContain('chevauche')
  })

  it('détecte et journalise un conflit d’adresse IP', () => {
    const { state, ids } = build([
      ['server', 'SRV1'],
      ['client', 'PC1'],
      ['switch', 'SW1']
    ])
    let s = cable(state, ids.SRV1!, 0, ids.SW1!, 0)
    s = cable(s, ids.PC1!, 0, ids.SW1!, 1)
    s = setIp(s, ids.SRV1!, 0, '192.168.1.1/24')
    const iface = s.devices[ids.PC1!]!.interfaces[0]!.id
    const r = unwrap(
      setInterfaceIpv4(s, ids.PC1!, iface, { addressing: 'static', address: '192.168.1.1', mask: '24' })
    )
    expect(r.value.warnings[0]).toContain('Conflit d’adresse IP')
    const log = r.state.devices[ids.PC1!]
    expect(log?.kind === 'client' && log.host.eventLog.at(-1)?.eventId).toBe(4199)
    expect(ipConflicts(r.state).size).toBe(2)
    const link = Object.values(r.state.links).find((l) => l.a.deviceId === ids.PC1)!
    expect(endStatus(r.state, link, 'a')).toBe('degraded')
  })

  it('journalise arrêt et démarrage', () => {
    const { state, ids } = build([['server', 'SRV1']])
    const off = unwrap(setPower(state, ids.SRV1!, false)).state
    const on = unwrap(setPower(off, ids.SRV1!, true)).state
    const d = on.devices[ids.SRV1!]
    expect(d?.kind === 'server' && d.host.eventLog.map((e) => e.eventId)).toEqual([6006, 6005])
  })
})

describe('routes statiques', () => {
  it('normalise l’adresse réseau et signale un prochain saut injoignable', () => {
    const { state, ids } = build([['router', 'R1']])
    const s = setIp(state, ids.R1!, 0, '10.0.0.1/30')
    const r = unwrap(
      addStaticRoute(s, ids.R1!, { network: '192.168.5.7', mask: '24', nextHop: '172.16.0.1' })
    )
    expect(r.value.warnings.join(' ')).toContain('192.168.5.0')
    expect(r.value.warnings.join(' ')).toContain('inactive')
    const dup = addStaticRoute(r.state, ids.R1!, {
      network: '192.168.5.0',
      mask: '24',
      nextHop: '172.16.0.1'
    })
    expect(dup.ok).toBe(false)
  })
})
