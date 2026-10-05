import { describe, expect, it } from 'vitest'
import {
  addPrimaryZone,
  addRecord,
  addStaticRoute,
  dnsServerOf,
  installFeatures,
  resolveName,
  setForwarders,
  setPower,
  unwrap,
  type LabState
} from '@engine/index'
import { build, cable, setIp } from '../helpers'
import { run } from '../shell/helpers'

/** SRV1 (DNS) et PC1 sur SW1, R1 vers Internet. */
function lab() {
  const { state, ids } = build([
    ['server', 'SRV1'],
    ['client', 'PC1'],
    ['switch', 'SW1'],
    ['router', 'R1'],
    ['cloud', 'INTERNET']
  ])
  let s = cable(state, ids.SRV1!, 0, ids.SW1!, 0)
  s = cable(s, ids.PC1!, 0, ids.SW1!, 1)
  s = cable(s, ids.SW1!, 2, ids.R1!, 0)
  s = cable(s, ids.R1!, 1, ids.INTERNET!, 0)
  s = setIp(s, ids.R1!, 0, '192.168.1.254/24')
  s = setIp(s, ids.R1!, 1, '203.0.113.1/30')
  s = setIp(s, ids.INTERNET!, 0, '203.0.113.2/30')
  s = unwrap(addStaticRoute(s, ids.R1!, { network: '0.0.0.0', mask: '0', nextHop: '203.0.113.2' })).state
  s = setIp(s, ids.SRV1!, 0, '192.168.1.1/24', '192.168.1.254', ['127.0.0.1'])
  s = setIp(s, ids.PC1!, 0, '192.168.1.10/24', '192.168.1.254', ['192.168.1.1'])
  s = unwrap(installFeatures(s, ids.SRV1!, ['DNS'], { includeManagementTools: true })).state
  s = unwrap(addPrimaryZone(s, ids.SRV1!, { name: 'lab.local' })).state
  s = unwrap(addRecord(s, ids.SRV1!, 'lab.local', { name: 'srv1', type: 'A', data: '192.168.1.1' })).state
  s = unwrap(addRecord(s, ids.SRV1!, 'lab.local', { name: 'pc1', type: 'A', data: '192.168.1.10' })).state
  return { s, ids }
}

function withReverse(s: LabState, srv: string): LabState {
  let r = unwrap(addPrimaryZone(s, srv, { networkId: '192.168.1.0/24' })).state
  r = unwrap(
    addRecord(r, srv, '1.168.192.in-addr.arpa', { name: '1', type: 'PTR', data: 'srv1.lab.local' })
  ).state
  return r
}

describe('DNS : zones et enregistrements', () => {
  it('crée SOA/NS, normalise les noms, détecte les conflits CNAME', () => {
    const { s, ids } = lab()
    const srv = s.devices[ids.SRV1!]
    const zone = srv?.kind === 'server' ? dnsServerOf(srv)?.zones[0] : undefined
    expect(zone?.records.map((r) => r.type)).toEqual(['SOA', 'NS', 'A', 'A'])
    const cname = unwrap(
      addRecord(s, ids.SRV1!, 'lab.local', { name: 'www', type: 'CNAME', data: 'srv1.lab.local' })
    ).state
    expect(addRecord(cname, ids.SRV1!, 'lab.local', { name: 'www', type: 'A', data: '192.168.1.5' }).ok).toBe(
      false
    )
    expect(addPrimaryZone(s, ids.SRV1!, { name: 'LAB.local.' }).ok).toBe(false)
  })

  it('-CreatePtr sans zone inverse : avertissement réaliste', () => {
    const { s, ids } = lab()
    const r = unwrap(
      addRecord(s, ids.SRV1!, 'lab.local', { name: 'web', type: 'A', data: '192.168.1.20', createPtr: true })
    )
    expect(r.value.warnings[0]).toContain('zone de recherche inversée référencée est introuvable')
    const withRev = unwrap(addPrimaryZone(s, ids.SRV1!, { networkId: '192.168.1.0/24' })).state
    const ok = unwrap(
      addRecord(withRev, ids.SRV1!, 'lab.local', {
        name: 'web',
        type: 'A',
        data: '192.168.1.20',
        createPtr: true
      })
    )
    expect(ok.value.warnings).toEqual([])
    const srv = ok.state.devices[ids.SRV1!]
    const rev = srv?.kind === 'server' ? dnsServerOf(srv)?.zones.find((z) => z.reverse) : undefined
    expect(rev?.records.find((r) => r.type === 'PTR')).toMatchObject({ name: '20', data: 'web.lab.local.' })
  })
})

describe('DNS : résolution', () => {
  it('résout un nom de la zone (réponse faisant autorité) avec trace DNS', () => {
    const { s, ids } = lab()
    const r = resolveName(s, ids.PC1!, 'pc1.lab.local')
    expect(r.result).toMatchObject({ kind: 'answer', authoritative: true })
    expect(r.trace.events.some((e) => e.protocol === 'DNS')).toBe(true)
  })

  it('suit un alias CNAME', () => {
    const { s: base, ids } = lab()
    const s = unwrap(
      addRecord(base, ids.SRV1!, 'lab.local', { name: 'www', type: 'CNAME', data: 'srv1.lab.local' })
    ).state
    const out = run(s, ids.PC1!, 'nslookup www.lab.local', { shell: 'cmd' })
    expect(out.text).toContain('Nom :    srv1.lab.local')
    expect(out.text).toContain('Address:  192.168.1.1')
    expect(out.text).toContain('Aliases:  www.lab.local')
  })

  it('nslookup affiche « UnKnown » sans zone inverse, le nom du serveur sinon', () => {
    const { s, ids } = lab()
    expect(run(s, ids.PC1!, 'nslookup pc1.lab.local', { shell: 'cmd' }).text).toContain('Serveur :   UnKnown')
    const rev = withReverse(s, ids.SRV1!)
    const out = run(rev, ids.PC1!, 'nslookup pc1.lab.local', { shell: 'cmd' })
    expect(out.text).toContain('Serveur :   srv1.lab.local')
    expect(out.text).toContain('Address:  192.168.1.10')
  })

  it('nom inexistant et serveur injoignable', () => {
    const { s, ids } = lab()
    expect(run(s, ids.PC1!, 'nslookup inconnu.lab.local', { shell: 'cmd' }).errors).toContain(
      'ne parvient pas à trouver inconnu.lab.local : Non-existent domain'
    )
    const off = unwrap(setPower(s, ids.SRV1!, false)).state
    const t = run(off, ids.PC1!, 'nslookup pc1.lab.local', { shell: 'cmd' })
    expect(t.text).toContain('DNS request timed out.')
    expect(t.errors).toContain('a expiré')
  })

  it('ping par nom (et échec d’un nom court sans suffixe)', () => {
    const { s, ids } = lab()
    const ok = run(s, ids.PC1!, 'ping srv1.lab.local', { shell: 'cmd' })
    expect(ok.text).toContain(
      "Envoi d’une requête 'ping' sur srv1.lab.local [192.168.1.1] avec 32 octets de données :"
    )
    expect(ok.text).toContain('Réponse de 192.168.1.1')
    expect(run(s, ids.PC1!, 'ping srv1', { shell: 'cmd' }).text).toContain('n’a pas pu trouver l’hôte srv1')
  })

  it('résolution Internet via redirecteur, ou indications de racine', () => {
    const { s, ids } = lab()
    const fwd = unwrap(setForwarders(s, ids.SRV1!, ['8.8.8.8'])).state
    const out = run(fwd, ids.PC1!, 'nslookup www.example.com', { shell: 'cmd' })
    expect(out.text).toContain('Réponse ne faisant pas autorité :')
    expect(out.text).toContain('Address:  93.184.215.14')
    // Sans redirecteur : indications de racine (Internet joignable)
    expect(resolveName(s, ids.PC1!, 'www.example.com').result.kind).toBe('answer')
    // Internet coupé : échec du serveur
    const cut = unwrap(setPower(s, ids.INTERNET!, false)).state
    expect(resolveName(cut, ids.PC1!, 'www.example.com').result.kind).toBe('servfail')
  })
})

describe('DNS : console', () => {
  it('cmdlets DnsServer et Resolve-DnsName', () => {
    const { s, ids } = lab()
    expect(run(s, ids.SRV1!, 'Add-DnsServerPrimaryZone -Name "test.local"').errors).toContain(
      'Le jeu de paramètres ne peut pas être résolu'
    )
    expect(
      run(s, ids.SRV1!, 'Add-DnsServerPrimaryZone -Name "test.local" -ReplicationScope Domain').errors
    ).toContain('contrôleur de domaine')
    let r = run(
      s,
      ids.SRV1!,
      'Add-DnsServerPrimaryZone -NetworkId "192.168.1.0/24" -ZoneFile "1.168.192.in-addr.arpa.dns"'
    )
    expect(r.errors).toBe('')
    r = run(
      r.state,
      ids.SRV1!,
      'Add-DnsServerResourceRecordA -Name web -ZoneName lab.local -IPv4Address 192.168.1.20 -CreatePtr'
    )
    expect(r.text).not.toContain('AVERTISSEMENT')
    r = run(
      r.state,
      ids.SRV1!,
      'Add-DnsServerResourceRecordCName -Name intranet -HostNameAlias web.lab.local -ZoneName lab.local'
    )
    expect(r.errors).toBe('')
    const zones = run(r.state, ids.SRV1!, 'Get-DnsServerZone')
    expect(zones.text).toMatch(/1\.168\.192\.in-addr\.arpa\s+Primary\s+False\s+False\s+True/)
    const resolved = run(r.state, ids.PC1!, 'Resolve-DnsName intranet.lab.local')
    expect(resolved.text).toContain('CNAME')
    expect(resolved.text).toContain('192.168.1.20')
    expect(run(r.state, ids.PC1!, 'Resolve-DnsName nope.lab.local').errors).toContain('Nom DNS inexistant')
  })
})
