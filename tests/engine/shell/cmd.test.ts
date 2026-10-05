import { describe, expect, it } from 'vitest'
import { createShellSession, executeLine } from '@engine/index'
import { build, cable, setIp } from '../helpers'
import { run } from './helpers'

function lab() {
  const { state, ids } = build([
    ['server', 'SRV1'],
    ['client', 'PC1'],
    ['switch', 'SW1']
  ])
  let s = cable(state, ids.SRV1!, 0, ids.SW1!, 0)
  s = cable(s, ids.PC1!, 0, ids.SW1!, 1)
  s = setIp(s, ids.SRV1!, 0, '192.168.1.1/24')
  s = setIp(s, ids.PC1!, 0, '192.168.1.10/24', '192.168.1.254', ['192.168.1.1'])
  return { s, ids }
}

describe('Invite de commandes', () => {
  it('ipconfig et ipconfig /all', () => {
    const { s, ids } = lab()
    const r = run(s, ids.PC1!, 'ipconfig', { shell: 'cmd' })
    expect(r.text).toContain('Carte Ethernet Ethernet0 :')
    expect(r.text).toMatch(/Adresse IPv4[ .]*: 192\.168\.1\.10/)
    expect(r.text).toMatch(/Masque de sous-réseau[ .]*: 255\.255\.255\.0/)
    expect(r.text).toMatch(/Passerelle par défaut[ .]*: 192\.168\.1\.254/)
    const all = run(s, ids.PC1!, 'ipconfig /all', { shell: 'cmd' })
    expect(all.text).toContain('Nom de l’hôte . . . . . . . . . . : PC1')
    expect(all.text).toMatch(/Adresse physique[ .]*: 02-53-4C/)
    expect(all.text).toMatch(/DHCP activé[ .]*: Non/)
    expect(all.text).toMatch(/Serveurs DNS[ .]*: 192\.168\.1\.1/)
  })

  it('ipconfig signale un média déconnecté et une adresse APIPA', () => {
    const { state, ids } = build([
      ['client', 'PC1'],
      ['switch', 'SW1']
    ])
    expect(run(state, ids.PC1!, 'ipconfig', { shell: 'cmd' }).text).toMatch(
      /Statut du média[ .]*: Média déconnecté/
    )
    const linked = cable(state, ids.PC1!, 0, ids.SW1!, 0)
    expect(run(linked, ids.PC1!, 'ipconfig', { shell: 'cmd' }).text).toMatch(
      /Adresse d’autoconfiguration IPv4[ .]*: 169\.254\./
    )
  })

  it('ping produit une trace et la sortie attendue', () => {
    const { s, ids } = lab()
    const r = run(s, ids.PC1!, 'ping 192.168.1.1', { shell: 'cmd' })
    expect(r.text).toContain('Réponse de 192.168.1.1 : octets=32 temps<1ms TTL=128')
    expect(r.traceEvents).toBeGreaterThan(0)
    expect(run(s, ids.PC1!, 'ping -n 2 192.168.1.1', { shell: 'cmd' }).text).toContain('envoyés = 2')
  })

  it('whoami, hostname et commande inconnue', () => {
    const { s, ids } = lab()
    expect(run(s, ids.SRV1!, 'whoami', { shell: 'cmd' }).text).toBe('srv1\\administrateur')
    expect(run(s, ids.PC1!, 'hostname', { shell: 'cmd' }).text).toBe('PC1')
    expect(run(s, ids.PC1!, 'truc', { shell: 'cmd' }).errors).toContain(
      'n’est pas reconnu en tant que commande interne'
    )
  })

  it('powershell depuis cmd puis exit', () => {
    const { s, ids } = lab()
    let session = createShellSession(s, ids.PC1!, 'cmd')
    session = executeLine(s, session, 'powershell').session
    expect(session.stack).toEqual(['cmd', 'powershell'])
    session = executeLine(s, session, 'exit').session
    expect(session.stack).toEqual(['cmd'])
  })

  it('les outils fonctionnent aussi dans PowerShell', () => {
    const { s, ids } = lab()
    expect(run(s, ids.PC1!, 'ipconfig').text).toContain('Carte Ethernet Ethernet0 :')
  })

  it('Restart-Computer applique le renommage en attente', () => {
    const { s, ids } = lab()
    const r1 = run(s, ids.SRV1!, 'Rename-Computer -NewName SRV-DC')
    expect(r1.text).toContain('après le redémarrage')
    const r2 = run(r1.state, ids.SRV1!, 'Restart-Computer')
    expect(r2.state.devices[ids.SRV1!]!.name).toBe('SRV-DC')
  })
})
