/**
 * Rôle WSUS : post-installation, synchronisation, groupes, approbations, ciblage côté serveur et
 * côté client, et stratégie « emplacement intranet du service de mise à jour » appliquée aux postes.
 */
import { describe, expect, it } from 'vitest'
import {
  command,
  dispatch,
  evaluateCheck,
  installFeatures,
  unwrap,
  wsusClientStatus,
  wsusComputers,
  wsusServerOf,
  type AnyCommand,
  type LabState
} from '@engine/index'
import { buildReferenceLab } from '../serialization/reference-lab'
import { run } from '../shell/helpers'

const D = 'lab.local'
const id = (s: LabState, name: string) => Object.values(s.devices).find((d) => d.name === name)?.id ?? ''

function exec(state: LabState, ...cmds: AnyCommand[]): LabState {
  let s = state
  for (const cmd of cmds) {
    const r = dispatch(s, cmd)
    if (!r.ok) throw new Error(`${cmd.type} : ${r.error.message}`)
    s = r.state
  }
  return s
}

/** SRV1 avec WSUS installé, configuré et synchronisé ; groupe « Postes » créé. */
function wsusLab(): LabState {
  let s = buildReferenceLab()
  const srv = id(s, 'SRV1')
  s = unwrap(installFeatures(s, srv, ['UpdateServices'], { includeManagementTools: true })).state
  return exec(
    s,
    command('wsus.postInstall', srv, 'C:\\WSUS'),
    command('wsus.synchronize', srv),
    command('wsus.addGroup', srv, 'Postes')
  )
}

/** GPO liée au domaine : serveur WSUS intranet (et groupe demandé), puis gpupdate sur PC1. */
function withPolicy(state: LabState, url: string, group?: string): LabState {
  let s = exec(state, command('gpo.createAndLink', D, { name: 'WSUS' }, null))
  const gpo = s.domains[D]!.gpos.find((g) => g.name === 'WSUS')!
  s = exec(
    s,
    command('gpo.updateSettings', D, gpo.id, {
      computer: {
        wuServer: { state: 'Enabled', url },
        ...(group ? { wuTargetGroup: { state: 'Enabled' as const, group } } : {})
      }
    })
  )
  return run(s, id(s, 'PC1'), 'gpupdate /force', { shell: 'cmd' }).state
}

describe('rôle WSUS', () => {
  it('installation : rôle, sous-fonctionnalités et outils', () => {
    const s = wsusLab()
    const features = s.devices[id(s, 'SRV1')]!
    expect(features.kind === 'server' && features.host.features).toEqual(
      expect.arrayContaining([
        'UpdateServices',
        'UpdateServices-WidDB',
        'UpdateServices-API',
        'UpdateServices-UI'
      ])
    )
  })

  it('synchronisation : refusée avant la post-installation, puis limitée aux classifications choisies', () => {
    let s = buildReferenceLab()
    const srv = id(s, 'SRV1')
    s = unwrap(installFeatures(s, srv, ['UpdateServices'])).state
    const early = dispatch(s, command('wsus.synchronize', srv))
    expect(!early.ok && early.error.code).toBe('WsusNotConfigured')
    const badDir = dispatch(s, command('wsus.postInstall', srv, 'WSUS'))
    expect(!badDir.ok && badDir.error.code).toBe('InvalidPath')
    s = exec(s, command('wsus.postInstall', srv, 'c:\\WSUS\\'), command('wsus.synchronize', srv))
    const wsus = wsusServerOf(s.devices[srv])!
    expect(wsus.contentDir).toBe('C:\\WSUS')
    expect(wsus.lastSync).toBe(s.clock)
    // Par défaut : mises à jour critiques et de sécurité seulement
    expect(wsus.updates).toEqual(['KB9100101', 'KB9100102', 'KB9100103', 'KB9100201', 'KB9100202'])
    s = exec(s, command('wsus.setClassification', srv, 'drivers', true), command('wsus.synchronize', srv))
    expect(wsusServerOf(s.devices[srv])!.updates).toContain('KB9100401')
    // Retirer une classification ne supprime pas les mises à jour déjà synchronisées
    s = exec(s, command('wsus.setClassification', srv, 'drivers', false), command('wsus.synchronize', srv))
    expect(wsusServerOf(s.devices[srv])!.updates).toContain('KB9100401')
  })

  it('groupes : noms uniques, groupes intégrés protégés, suppression des approbations liées', () => {
    let s = wsusLab()
    const srv = id(s, 'SRV1')
    const dup = dispatch(s, command('wsus.addGroup', srv, 'postes'))
    expect(!dup.ok && dup.error.code).toBe('GroupExists')
    const builtin = dispatch(s, command('wsus.removeGroup', srv, 'Tous les ordinateurs'))
    expect(!builtin.ok && builtin.error.code).toBe('BuiltInGroup')
    s = exec(
      s,
      command('wsus.approve', srv, 'KB9100102', 'Postes', true),
      command('wsus.removeGroup', srv, 'Postes')
    )
    expect(wsusServerOf(s.devices[srv])!.approvals).toEqual([])
  })

  it('un poste sans stratégie WSUS n’est pas client du serveur', () => {
    const s = wsusLab()
    expect(wsusClientStatus(s, id(s, 'PC1')).kind).toBe('none')
    expect(wsusComputers(s, id(s, 'SRV1'))).toEqual([])
  })

  it('stratégie de groupe appliquée : le poste contacte le serveur en HTTP sur le port 8530', () => {
    const s = withPolicy(wsusLab(), 'http://srv1.lab.local:8530')
    const status = wsusClientStatus(s, id(s, 'PC1'))
    expect(status.kind).toBe('ok')
    if (status.kind !== 'ok') return
    expect(status.server.name).toBe('SRV1')
    expect(status.group).toBe('Ordinateurs non attribués')
    expect(status.trace.events.some((e) => e.protocol === 'HTTP')).toBe(true)
    expect(wsusComputers(s, id(s, 'SRV1')).map((c) => c.name)).toEqual(['pc1.lab.local'])
  })

  it('mauvaise URL : port ou nom incorrect, le poste ne joint pas le serveur', () => {
    const noPort = withPolicy(wsusLab(), 'http://srv1.lab.local')
    const status = wsusClientStatus(noPort, id(noPort, 'PC1'))
    expect(status.kind === 'error' && status.message).toMatch(/0x80072EFD/)
    const badName = withPolicy(wsusLab(), 'http://inconnu.lab.local:8530')
    expect(wsusClientStatus(badName, id(badName, 'PC1')).kind).toBe('error')
  })

  it('acceptation : un poste ne reçoit que les mises à jour approuvées pour son groupe (ciblage serveur)', () => {
    let s = withPolicy(wsusLab(), 'http://srv1.lab.local:8530')
    const srv = id(s, 'SRV1')
    const pc1 = id(s, 'PC1')
    s = exec(
      s,
      command('wsus.approve', srv, 'KB9100102', 'Postes', true),
      command('wsus.approve', srv, 'KB9100201', 'Ordinateurs non attribués', true)
    )
    // Encore dans « Ordinateurs non attribués »
    expect(wsusClientStatus(s, pc1).kind === 'ok' && wsusUpdates(s, pc1)).toEqual(['KB9100201'])
    s = exec(s, command('wsus.assignComputer', srv, pc1, 'Postes'))
    expect(wsusUpdates(s, pc1)).toEqual(['KB9100102'])
    // Approbation sur la racine : héritée par tous les groupes ; produit serveur : non applicable au poste
    s = exec(
      s,
      command('wsus.approve', srv, 'KB9100103', 'Tous les ordinateurs', true),
      command('wsus.approve', srv, 'KB9100101', 'Postes', true)
    )
    expect(wsusUpdates(s, pc1)).toEqual(['KB9100102', 'KB9100103'])
    // Refuser retire les approbations
    s = exec(s, command('wsus.decline', srv, 'KB9100103', true))
    expect(wsusUpdates(s, pc1)).toEqual(['KB9100102'])
    expect(wsusServerOf(s.devices[srv])!.approvals.some((a) => a.updateId === 'KB9100103')).toBe(false)
  })

  it('ciblage côté client : le groupe vient de la stratégie, la console ne peut plus déplacer le poste', () => {
    let s = withPolicy(wsusLab(), 'http://srv1.lab.local:8530', 'postes')
    const srv = id(s, 'SRV1')
    const pc1 = id(s, 'PC1')
    // Ciblage côté serveur : le groupe demandé par la stratégie est ignoré
    expect(wsusComputers(s, srv)[0]?.group).toBe('Ordinateurs non attribués')
    s = exec(s, command('wsus.setTargeting', srv, 'client'))
    expect(wsusComputers(s, srv)[0]?.group).toBe('Postes')
    const move = dispatch(s, command('wsus.assignComputer', srv, pc1, 'Postes'))
    expect(!move.ok && move.error.code).toBe('ClientSideTargeting')
    // Groupe demandé inexistant : « Ordinateurs non attribués »
    s = withPolicy(
      exec(wsusLab(), command('wsus.setTargeting', id(wsusLab(), 'SRV1'), 'client')),
      'http://srv1:8530',
      'Inconnu'
    )
    expect(wsusComputers(s, id(s, 'SRV1'))[0]?.group).toBe('Ordinateurs non attribués')
  })

  it('approbation d’une mise à jour non synchronisée ou pour un groupe inconnu : refusée', () => {
    const s = wsusLab()
    const srv = id(s, 'SRV1')
    const notSynced = dispatch(s, command('wsus.approve', srv, 'KB9100401', 'Postes', true))
    expect(!notSynced.ok && notSynced.error.code).toBe('UpdateNotFound')
    const noGroup = dispatch(s, command('wsus.approve', srv, 'KB9100101', 'Inconnu', true))
    expect(!noGroup.ok && noGroup.error.code).toBe('GroupNotFound')
  })

  it('critères de lab', () => {
    let s = withPolicy(wsusLab(), 'http://srv1.lab.local:8530')
    const srv = id(s, 'SRV1')
    s = exec(
      s,
      command('wsus.assignComputer', srv, id(s, 'PC1'), 'Postes'),
      command('wsus.approve', srv, 'KB9100102', 'Postes', true)
    )
    expect(evaluateCheck(s, { type: 'wsusSynchronized', server: 'SRV1' })).toBe(true)
    expect(
      evaluateCheck(s, { type: 'wsusApproval', server: 'SRV1', update: 'kb9100102', group: 'postes' })
    ).toBe(true)
    expect(
      evaluateCheck(s, { type: 'wsusComputerGroup', server: 'SRV1', computer: 'PC1', group: 'Postes' })
    ).toBe(true)
    expect(
      evaluateCheck(s, { type: 'wsusClientUpdate', client: 'PC1', update: 'KB9100102', received: true })
    ).toBe(true)
    expect(
      evaluateCheck(s, { type: 'wsusClientUpdate', client: 'PC1', update: 'KB9100201', received: false })
    ).toBe(true)
    expect(
      evaluateCheck(s, { type: 'wsusClientUpdate', client: 'PC2', update: 'KB9100102', received: false })
    ).toBe(false)
  })
})

function wsusUpdates(s: LabState, clientId: string): string[] {
  const status = wsusClientStatus(s, clientId)
  return status.kind === 'ok' ? status.updates.map((u) => u.id) : []
}
