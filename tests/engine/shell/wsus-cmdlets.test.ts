/**
 * Cmdlets du module UpdateServices : mêmes effets que la console WSUS (commandes nommées).
 */
import { describe, expect, it } from 'vitest'
import {
  command,
  dispatch,
  installFeatures,
  unwrap,
  wsusServerOf,
  type AnyCommand,
  type LabState
} from '@engine/index'
import { buildReferenceLab } from '../serialization/reference-lab'
import { run } from './helpers'

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

function lab(configured = true): LabState {
  let s = buildReferenceLab()
  const srv = id(s, 'SRV1')
  s = unwrap(installFeatures(s, srv, ['UpdateServices'], { includeManagementTools: true })).state
  if (!configured) return s
  s = exec(s, command('wsus.postInstall', srv, 'C:\\WSUS'), command('wsus.synchronize', srv))
  return exec(s, command('wsus.addGroup', srv, 'Postes'))
}

/** PC1 client du serveur par une GPO liée au domaine. */
function withClient(state: LabState): LabState {
  let s = exec(state, command('gpo.createAndLink', D, { name: 'WSUS' }, null))
  const gpo = s.domains[D]!.gpos.find((g) => g.name === 'WSUS')!
  s = exec(
    s,
    command('gpo.updateSettings', D, gpo.id, {
      computer: { wuServer: { state: 'Enabled', url: 'http://srv1.lab.local:8530' } }
    })
  )
  return run(s, id(s, 'PC1'), 'gpupdate /force', { shell: 'cmd' }).state
}

const wsus = (s: LabState) => wsusServerOf(s.devices[id(s, 'SRV1')])!

describe('cmdlets UpdateServices', () => {
  it('module absent sans les outils WSUS ; serveur non configuré : erreur claire', () => {
    const none = run(buildReferenceLab(), id(buildReferenceLab(), 'SRV1'), 'Get-WsusServer')
    expect(none.errors).toMatch(/n'est pas reconnu/)
    const s = lab(false)
    const r = run(s, id(s, 'SRV1'), 'Get-WsusServer')
    expect(r.errors).toMatch(/post-installation/)
  })

  it('Get-WsusServer : nom et port 8530', () => {
    const s = lab()
    const r = run(s, id(s, 'SRV1'), 'Get-WsusServer')
    expect(r.errors).toBe('')
    expect(r.text).toMatch(/Name\s+: SRV1/)
    expect(r.text).toMatch(/PortNumber\s+: 8530/)
  })

  it('Get-WsusUpdate : filtres d’approbation et de classification', () => {
    let s = lab()
    const srv = id(s, 'SRV1')
    let r = run(s, srv, '(Get-WsusUpdate -Classification Critical).UpdateId')
    expect(r.text).toContain('KB9100201')
    expect(r.text).not.toContain('KB9100101')
    s = exec(s, command('wsus.approve', srv, 'KB9100101', 'Postes', true))
    r = run(s, srv, '(Get-WsusUpdate -Approval Approved).UpdateId')
    expect(r.text).toContain('KB9100101')
    expect(r.text).not.toContain('KB9100102')
    r = run(s, srv, 'Get-WsusUpdate -UpdateId KB0000000')
    expect(r.errors).toMatch(/introuvable/)
  })

  it('Approve-WsusUpdate et Deny-WsusUpdate par le pipeline : même état que la console', () => {
    const viaPs = lab()
    const srv = id(viaPs, 'SRV1')
    let s = run(
      viaPs,
      srv,
      "Get-WsusUpdate -Classification Security | Approve-WsusUpdate -Action Install -TargetGroupName 'Postes'"
    ).state
    s = run(s, srv, 'Get-WsusUpdate -UpdateId KB9100201 | Deny-WsusUpdate').state
    const viaGui = exec(
      lab(),
      ...['KB9100101', 'KB9100102', 'KB9100103'].map((u) => command('wsus.approve', srv, u, 'Postes', true)),
      command('wsus.decline', srv, 'KB9100201', true)
    )
    expect(wsus(s).approvals).toEqual(wsus(viaGui).approvals)
    expect(wsus(s).declined).toEqual(['KB9100201'])
    const bad = run(
      s,
      srv,
      'Get-WsusUpdate -UpdateId KB9100101 | Approve-WsusUpdate -Action Install -TargetGroupName Inconnu'
    )
    expect(bad.errors).toMatch(/n’existe pas/)
  })

  it('Get-WsusClassification | Set-WsusClassification : synchronisation des pilotes', () => {
    const s = lab()
    const srv = id(s, 'SRV1')
    const after = run(
      s,
      srv,
      "Get-WsusClassification | Where-Object { $_.Classification.Title -eq 'Pilotes' } | Set-WsusClassification"
    )
    expect(after.errors).toBe('')
    expect(wsus(after.state).classifications).toContain('drivers')
    const off = run(
      after.state,
      srv,
      "Get-WsusClassification | Where-Object { $_.Classification.Title -eq 'Pilotes' } | Set-WsusClassification -Disable"
    )
    expect(wsus(off.state).classifications).not.toContain('drivers')
  })

  it('Get-WsusComputer et Add-WsusComputer : ciblage côté serveur', () => {
    const s = withClient(lab())
    const srv = id(s, 'SRV1')
    let r = run(s, srv, 'Get-WsusComputer')
    expect(r.text).toContain('pc1.lab.local')
    expect(r.text).toContain('Ordinateurs non attribués')
    r = run(s, srv, "Get-WsusComputer -NameIncludes pc1 | Add-WsusComputer -TargetGroupName 'Postes'")
    expect(r.errors).toBe('')
    expect(wsus(r.state).assignments).toEqual([{ computerId: id(s, 'PC1'), group: 'Postes' }])
    const empty = run(lab(), srv, 'Get-WsusComputer')
    expect(empty.text).toContain('Aucun ordinateur disponible.')
  })
})
