import { describe, expect, it } from 'vitest'
import {
  addStaticRoute,
  ping,
  setInterfaceEnabled,
  setPower,
  tracert,
  unwrap,
  type LabState
} from '@engine/index'
import { build, cable, setIp } from '../helpers'

function doPing(state: LabState, src: string, dst: string, count = 4) {
  const r = ping(state, src, dst, { count })
  if (!r.ok) throw new Error(r.error.message)
  return r.value
}

/** PC1 et SRV1 sur le même switch, 192.168.1.0/24. */
function lan() {
  const { state, ids } = build([
    ['client', 'PC1'],
    ['server', 'SRV1'],
    ['switch', 'SW1']
  ])
  let s = cable(state, ids.PC1!, 0, ids.SW1!, 0)
  s = cable(s, ids.SRV1!, 0, ids.SW1!, 1)
  s = setIp(s, ids.PC1!, 0, '192.168.1.10/24', '192.168.1.254')
  s = setIp(s, ids.SRV1!, 0, '192.168.1.1/24')
  return { s, ids }
}

/** PC1 (LAN 1) — R1 — SRV1 (LAN 2). */
function routed(withServerGateway = true) {
  const { state, ids } = build([
    ['client', 'PC1'],
    ['server', 'SRV1'],
    ['router', 'R1'],
    ['switch', 'SW1'],
    ['switch', 'SW2']
  ])
  let s = cable(state, ids.PC1!, 0, ids.SW1!, 0)
  s = cable(s, ids.SW1!, 1, ids.R1!, 0)
  s = cable(s, ids.R1!, 1, ids.SW2!, 0)
  s = cable(s, ids.SW2!, 1, ids.SRV1!, 0)
  s = setIp(s, ids.R1!, 0, '192.168.1.254/24')
  s = setIp(s, ids.R1!, 1, '192.168.2.254/24')
  s = setIp(s, ids.PC1!, 0, '192.168.1.10/24', '192.168.1.254')
  s = setIp(s, ids.SRV1!, 0, '192.168.2.10/24', withServerGateway ? '192.168.2.254' : undefined)
  return { s, ids }
}

describe('ping sur un même réseau local', () => {
  it('reçoit 4 réponses avec un TTL de 128', () => {
    const { s, ids } = lan()
    const r = doPing(s, ids.PC1!, '192.168.1.1')
    expect(r.success).toBe(true)
    expect(r.lines[0]).toBe("Envoi d’une requête 'Ping'  192.168.1.1 avec 32 octets de données :")
    expect(r.lines[1]).toBe('Réponse de 192.168.1.1 : octets=32 temps<1ms TTL=128')
    expect(r.lines).toContain('    Paquets : envoyés = 4, reçus = 4, perdus = 0 (perte 0%),')
  })

  it('produit une trace ARP (diffusion) puis ICMP', () => {
    const { s, ids } = lan()
    const r = doPing(s, ids.PC1!, '192.168.1.1', 1)
    const protocols = r.trace.events.map((e) => e.protocol)
    expect(protocols[0]).toBe('ARP')
    expect(protocols).toContain('ICMP')
    // Le switch inonde la requête ARP : SRV1 la traite
    const arpToServer = r.trace.events.find((e) => e.protocol === 'ARP' && e.toDeviceId === ids.SRV1)
    expect(arpToServer?.outcome).toBe('delivered')
    // Une seule résolution ARP pour plusieurs échos, et le serveur n'a pas besoin de faire d'ARP pour répondre
    const multi = doPing(s, ids.PC1!, '192.168.1.1', 4)
    const requests = multi.trace.events.filter((e) => e.summary.startsWith('ARP : qui a'))
    expect(requests.filter((e) => e.fromDeviceId === ids.PC1)).toHaveLength(1)
    expect(requests.some((e) => e.fromDeviceId === ids.SRV1)).toBe(false)
  })

  it('signale « Impossible de joindre l’hôte » si personne ne répond à l’ARP', () => {
    const { s, ids } = lan()
    const r = doPing(s, ids.PC1!, '192.168.1.99')
    expect(r.lines[1]).toBe('Réponse de 192.168.1.10 : Impossible de joindre l’hôte de destination.')
    // Comme sous Windows, ces réponses comptent comme reçues
    expect(r.lines).toContain('    Paquets : envoyés = 4, reçus = 4, perdus = 0 (perte 0%),')
    expect(r.success).toBe(false)
  })

  it('échoue si la cible est éteinte ou si son port est désactivé', () => {
    const { s, ids } = lan()
    const off = unwrap(setPower(s, ids.SRV1!, false)).state
    expect(doPing(off, ids.PC1!, '192.168.1.1').success).toBe(false)
    const sw = s.devices[ids.SW1!]!
    const disabled = unwrap(setInterfaceEnabled(s, ids.SW1!, sw.interfaces[1]!.id, false)).state
    expect(doPing(disabled, ids.PC1!, '192.168.1.1').success).toBe(false)
  })

  it('répond à sa propre adresse et au bouclage', () => {
    const { s, ids } = lan()
    expect(doPing(s, ids.PC1!, '127.0.0.1').success).toBe(true)
    expect(doPing(s, ids.PC1!, '192.168.1.10').success).toBe(true)
  })

  it('refuse un nom d’hôte inconnu', () => {
    const { s, ids } = lan()
    const r = ping(s, ids.PC1!, 'serveur')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.message).toContain('n’a pas pu trouver l’hôte serveur')
  })

  it('permet aux hôtes APIPA de communiquer entre eux', () => {
    const { state, ids } = build([
      ['client', 'PC1'],
      ['client', 'PC2'],
      ['switch', 'SW1']
    ])
    let s = cable(state, ids.PC1!, 0, ids.SW1!, 0)
    s = cable(s, ids.PC2!, 0, ids.SW1!, 1)
    const pc2Ip =
      '169.254.' +
      s.devices[ids.PC2!]!.interfaces[0]!.mac.split('-')
        .slice(4)
        .map((b) => (parseInt(b, 16) % 254) + 1)
        .join('.')
    expect(doPing(s, ids.PC1!, pc2Ip).success).toBe(true)
  })
})

describe('ping à travers un routeur', () => {
  it('passe par la passerelle (TTL décrémenté)', () => {
    const { s, ids } = routed()
    const r = doPing(s, ids.PC1!, '192.168.2.10')
    expect(r.success).toBe(true)
    expect(r.lines[1]).toBe('Réponse de 192.168.2.10 : octets=32 temps=2 ms TTL=127')
  })

  it('échoue sans passerelle par défaut (défaillance générale)', () => {
    const { s, ids } = routed()
    const noGw = setIp(s, ids.PC1!, 0, '192.168.1.10/24')
    const r = doPing(noGw, ids.PC1!, '192.168.2.10')
    expect(r.lines[1]).toBe('PING : échec de la transmission. Défaillance générale.')
    expect(r.lines).toContain('    Paquets : envoyés = 4, reçus = 0, perdus = 4 (perte 100%),')
  })

  it('échoue avec un mauvais masque (cible jugée hors réseau sans passerelle)', () => {
    const { s, ids } = lan()
    const bad = setIp(s, ids.PC1!, 0, '192.168.1.10/30')
    expect(doPing(bad, ids.PC1!, '192.168.1.1').lines[1]).toBe(
      'PING : échec de la transmission. Défaillance générale.'
    )
  })

  it('n’obtient pas de réponse si le serveur n’a pas de passerelle (retour impossible)', () => {
    const { s, ids } = routed(false)
    const r = doPing(s, ids.PC1!, '192.168.2.10')
    expect(r.lines[1]).toBe('Délai d’attente de la demande dépassé.')
    expect(r.lines).toContain('    Paquets : envoyés = 4, reçus = 0, perdus = 4 (perte 100%),')
  })

  it('reçoit « Impossible de joindre le réseau » du routeur sans route', () => {
    const { s, ids } = routed()
    const r = doPing(s, ids.PC1!, '10.0.0.1')
    expect(r.lines[1]).toBe('Réponse de 192.168.1.254 : Impossible de joindre le réseau de destination.')
  })
})

describe('routage statique et Internet', () => {
  /** PC1 — R1 — R2 — SRV1, plus Internet derrière R2. */
  function chain(withRoutes: boolean) {
    const { state, ids } = build([
      ['client', 'PC1'],
      ['server', 'SRV1'],
      ['router', 'R1'],
      ['router', 'R2'],
      ['cloud', 'INTERNET']
    ])
    let s = cable(state, ids.PC1!, 0, ids.R1!, 0)
    s = cable(s, ids.R1!, 1, ids.R2!, 0)
    s = cable(s, ids.R2!, 1, ids.SRV1!, 0)
    s = cable(s, ids.R2!, 2, ids.INTERNET!, 0)
    s = setIp(s, ids.R1!, 0, '192.168.1.254/24')
    s = setIp(s, ids.R1!, 1, '10.0.0.1/30')
    s = setIp(s, ids.R2!, 0, '10.0.0.2/30')
    s = setIp(s, ids.R2!, 1, '192.168.2.254/24')
    s = setIp(s, ids.R2!, 2, '203.0.113.1/30')
    s = setIp(s, ids.INTERNET!, 0, '203.0.113.2/30')
    s = setIp(s, ids.PC1!, 0, '192.168.1.10/24', '192.168.1.254')
    s = setIp(s, ids.SRV1!, 0, '192.168.2.10/24', '192.168.2.254')
    if (withRoutes) {
      s = unwrap(addStaticRoute(s, ids.R1!, { network: '0.0.0.0', mask: '0', nextHop: '10.0.0.2' })).state
      s = unwrap(
        addStaticRoute(s, ids.R2!, { network: '192.168.1.0', mask: '255.255.255.0', nextHop: '10.0.0.1' })
      ).state
      s = unwrap(
        addStaticRoute(s, ids.R2!, { network: '0.0.0.0', mask: '0.0.0.0', nextHop: '203.0.113.2' })
      ).state
    }
    return { s, ids }
  }

  it('traverse deux routeurs grâce aux routes statiques', () => {
    const { s, ids } = chain(true)
    const r = doPing(s, ids.PC1!, '192.168.2.10')
    expect(r.success).toBe(true)
    expect(r.lines[1]).toContain('TTL=126')
  })

  it('échoue sans routes statiques', () => {
    const { s, ids } = chain(false)
    expect(doPing(s, ids.PC1!, '192.168.2.10').lines[1]).toBe(
      'Réponse de 192.168.1.254 : Impossible de joindre le réseau de destination.'
    )
  })

  it('joint un hôte Internet et ignore une adresse publique inexistante', () => {
    const { s, ids } = chain(true)
    const r = doPing(s, ids.PC1!, '8.8.8.8')
    expect(r.success).toBe(true)
    expect(r.lines[1]).toMatch(/^Réponse de 8\.8\.8\.8 : octets=32 temps=\d+ ms TTL=115$/)
    expect(doPing(s, ids.PC1!, '9.9.9.9').lines[1]).toBe('Délai d’attente de la demande dépassé.')
  })

  it('tracert liste les routeurs traversés', () => {
    const { s, ids } = chain(true)
    const r = tracert(s, ids.PC1!, '192.168.2.10')
    if (!r.ok) throw new Error(r.error.message)
    const hops = r.value.lines.filter((l) => /^\s+\d+\s/.test(l))
    expect(hops).toHaveLength(3)
    expect(hops[0]).toMatch(/192\.168\.1\.254$/)
    expect(hops[1]).toMatch(/10\.0\.0\.2$/)
    expect(hops[2]).toMatch(/192\.168\.2\.10$/)
    expect(r.value.reached).toBe(true)
    expect(r.value.lines.at(-1)).toBe('Itinéraire déterminé.')
  })
})
