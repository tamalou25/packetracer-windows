import { describe, expect, it } from 'vitest'
import {
  clearEventLog,
  completeDhcpPostInstall,
  installFeatures,
  joinDomain,
  logoff,
  logon,
  restartComputer,
  setPower,
  unwrap,
  verifyCredentials,
  type HostDevice,
  type LabState
} from '@engine/index'
import { build, cable, setIp } from '../helpers'
import { run } from '../shell/helpers'

function host(s: LabState, id: string): HostDevice {
  const d = s.devices[id]
  if (!d || (d.kind !== 'server' && d.kind !== 'client')) throw new Error('hôte absent')
  return d
}

/** SRV1 contrôleur de lab.local, PC1 joint au domaine (DNS → SRV1). */
function domainLab() {
  const { state, ids } = build([
    ['server', 'SRV1'],
    ['client', 'PC1'],
    ['switch', 'SW1']
  ])
  let s = cable(state, ids.SRV1!, 0, ids.SW1!, 0)
  s = cable(s, ids.PC1!, 0, ids.SW1!, 1)
  s = setIp(s, ids.SRV1!, 0, '192.168.1.1/24')
  s = setIp(s, ids.PC1!, 0, '192.168.1.10/24', undefined, ['192.168.1.1'])
  s = unwrap(
    installFeatures(s, ids.SRV1!, ['AD-Domain-Services', 'DHCP'], { includeManagementTools: true })
  ).state
  s = run(s, ids.SRV1!, 'Install-ADDSForest -DomainName lab.local -InstallDns', {
    answers: ['P@ssw0rd!', 'P@ssw0rd!', 'O']
  }).state
  const op = joinDomain(s, ids.PC1!, {
    domain: 'lab.local',
    user: 'LAB\\Administrateur',
    password: 'P@ssw0rd'
  })
  expect(op.ok).toBe(true)
  s = unwrap(restartComputer(op.state, ids.PC1!)).state
  return { s, ids }
}

describe('Démarrage et redémarrage', () => {
  it('un redémarrage met à jour l’heure de démarrage et journalise la raison', () => {
    const { state, ids } = build([['server', 'SRV1']])
    const before = host(state, ids.SRV1!).host.bootedAt
    const s = unwrap(restartComputer(state, ids.SRV1!, 'Autre (planifié)')).state
    const srv = host(s, ids.SRV1!)
    expect(srv.host.bootedAt).toBeGreaterThan(before)
    const event = srv.host.eventLog.find((e) => e.eventId === 1074)
    expect(event?.message).toContain('pour le compte SRV1\\Administrateur')
    expect(event?.message).toContain('pour la raison suivante : Autre (planifié)')
  })

  it('la mise sous tension compte comme un démarrage', () => {
    const { state, ids } = build([['client', 'PC1']])
    const off = unwrap(setPower(state, ids.PC1!, false)).state
    const on = unwrap(setPower(off, ids.PC1!, true)).state
    expect(host(on, ids.PC1!).host.bootedAt).toBeGreaterThan(host(state, ids.PC1!).host.bootedAt)
  })
})

describe('Vérification des identifiants (déverrouillage)', () => {
  it('compte local : Administrateur et mot de passe local', () => {
    const { state, ids } = build([['server', 'SRV1']])
    expect(
      verifyCredentials(state, ids.SRV1!, { user: 'Administrateur', password: 'P@ssw0rd', domain: null })
    ).toBe(true)
    expect(
      verifyCredentials(state, ids.SRV1!, { user: 'Administrateur', password: 'faux', domain: null })
    ).toBe(false)
  })

  it('compte du domaine, sans échange réseau', () => {
    const { s, ids } = domainLab()
    expect(
      verifyCredentials(s, ids.PC1!, { user: 'Administrateur', password: 'P@ssw0rd', domain: 'LAB' })
    ).toBe(true)
    expect(
      verifyCredentials(s, ids.PC1!, { user: 'LAB\\Administrateur', password: 'nope', domain: 'LAB' })
    ).toBe(false)
    // Le contrôle ne modifie pas l'état (pas de session ouverte, pas d'événement)
    const r = logon(s, ids.PC1!, { user: 'Administrateur', password: 'P@ssw0rd', domain: 'LAB' })
    expect(r.ok).toBe(true)
    expect(host(logoff(r.state, ids.PC1!), ids.PC1!).host.session).toBeNull()
  })
})

describe('DHCP : configuration post-installation', () => {
  it('groupe de travail : groupes créés, autorisation sans objet', () => {
    const { state, ids } = build([['server', 'SRV1']])
    const s = unwrap(installFeatures(state, ids.SRV1!, ['DHCP'], { includeManagementTools: true })).state
    const r = unwrap(completeDhcpPostInstall(s, ids.SRV1!, { authorize: true }))
    expect(r.value.authorization).toBe('not-member')
    const srv = r.state.devices[ids.SRV1!]
    expect(srv?.kind === 'server' && srv.services.dhcp?.configured).toBe(true)
  })

  it('membre du domaine : autorisation par un Admin du domaine, refusée sinon', () => {
    const { s, ids } = domainLab()
    const ok = unwrap(completeDhcpPostInstall(s, ids.SRV1!, { authorize: true }))
    expect(ok.value.authorization).toBe('done')
    const srv = ok.state.devices[ids.SRV1!]
    expect(srv?.kind === 'server' && srv.services.dhcp?.authorized).toBe(true)
    // Session locale (non administrateur du domaine) : accès refusé
    const local = logon(logoff(s, ids.SRV1!), ids.SRV1!, {
      user: 'Administrateur',
      password: 'P@ssw0rd',
      domain: null
    })
    const denied = completeDhcpPostInstall(local.state, ids.SRV1!, { authorize: true })
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.error.code).toBe('AccessDenied')
    const skipped = unwrap(completeDhcpPostInstall(local.state, ids.SRV1!, { authorize: false }))
    expect(skipped.value.authorization).toBe('skipped')
  })
})

describe('Observateur d’événements : effacer un journal', () => {
  it('vide le journal choisi et trace l’effacement', () => {
    const { s, ids } = domainLab()
    const before = host(s, ids.SRV1!).host.eventLog
    expect(before.some((e) => e.log === 'Sécurité')).toBe(true)
    const r = unwrap(clearEventLog(s, ids.SRV1!, 'Sécurité')).state
    const security = host(r, ids.SRV1!).host.eventLog.filter((e) => e.log === 'Sécurité')
    expect(security).toHaveLength(1)
    expect(security[0]?.eventId).toBe(1102)
    const sys = unwrap(clearEventLog(r, ids.SRV1!, 'Système')).state
    const system = host(sys, ids.SRV1!).host.eventLog.filter((e) => e.log === 'Système')
    expect(system.map((e) => e.eventId)).toEqual([104])
  })
})
