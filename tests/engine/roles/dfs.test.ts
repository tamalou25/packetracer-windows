/**
 * DFS : espace de noms de domaine (référence vers la cible en ligne) et réplication entre deux
 * serveurs (ajouts, modifications, suppressions, membre hors ligne), par la tâche de fond.
 */
import { describe, expect, it } from 'vitest'
import {
  addDevice,
  command,
  connect,
  dispatch,
  domainToken,
  evaluateCheck,
  findNode,
  installFeatures,
  joinDomain,
  openUnc,
  restartComputer,
  runBackgroundTasks,
  setInterfaceIpv4,
  setPower,
  unwrap,
  type AnyCommand,
  type LabState,
  type ServerDevice
} from '@engine/index'
import { buildReferenceLab } from '../serialization/reference-lab'
import { run } from '../shell/helpers'

const D = 'lab.local'
const id = (s: LabState, name: string) => Object.values(s.devices).find((d) => d.name === name)?.id ?? ''
const server = (s: LabState, name: string) => s.devices[id(s, name)] as ServerDevice

function exec(state: LabState, ...cmds: AnyCommand[]): LabState {
  let s = state
  for (const cmd of cmds) {
    const r = dispatch(s, cmd)
    if (!r.ok) throw new Error(`${cmd.type} : ${r.error.message}`)
    s = r.state
  }
  return s
}

/** Lab de référence + SRV2 (192.168.10.2) membre du domaine ; DFS sur SRV1 et SRV2 ; C:\Compta partagé. */
function lab(): LabState {
  let s = buildReferenceLab()
  s = unwrap(addDevice(s, { kind: 'server', position: { x: 0, y: 200 }, name: 'SRV2' })).state
  const srv2 = id(s, 'SRV2')
  const sw = s.devices[id(s, 'SW1')]!
  s = unwrap(
    connect(
      s,
      { deviceId: srv2, ifaceId: s.devices[srv2]!.interfaces[0]!.id },
      { deviceId: sw.id, ifaceId: sw.interfaces[5]!.id }
    )
  ).state
  s = unwrap(
    setInterfaceIpv4(s, srv2, s.devices[srv2]!.interfaces[0]!.id, {
      addressing: 'static',
      address: '192.168.10.2',
      mask: '24',
      gateway: null,
      dnsServers: ['192.168.10.1']
    })
  ).state
  const joined = joinDomain(s, srv2, { domain: D, user: 'LAB\\Administrateur', password: 'P@ssw0rd' })
  if (!joined.ok) throw new Error(joined.message)
  s = unwrap(restartComputer(joined.state, srv2)).state
  for (const name of ['SRV1', 'SRV2'])
    s = unwrap(
      installFeatures(s, id(s, name), ['FS-DFS-Namespace', 'FS-DFS-Replication'], {
        includeManagementTools: true
      })
    ).state
  const admin = domainToken(s.domains[D]!, 'Administrateur')!
  for (const name of ['SRV1', 'SRV2'])
    s = exec(
      s,
      command('files.createItem', id(s, name), 'C:\\Compta', 'folder', admin, {}),
      command(
        'files.createShare',
        id(s, name),
        { name: 'Compta', path: 'C:\\Compta', full: ['Tout le monde'] },
        admin
      )
    )
  return s
}

/** Groupe de réplication Compta entre SRV1 (principal) et SRV2 sur C:\Compta. */
function replicated(state: LabState): LabState {
  return exec(
    state,
    command('dfs.newGroup', id(state, 'SRV1'), 'Compta'),
    command('dfs.addMember', 'Compta', 'SRV1'),
    command('dfs.addMember', 'Compta', 'SRV2'),
    command('dfs.newReplicatedFolder', 'Compta', 'Compta'),
    command('dfs.setMembership', 'Compta', 'Compta', 'SRV1', { contentPath: 'C:\\Compta', primary: true }),
    command('dfs.setMembership', 'Compta', 'Compta', 'SRV2', { contentPath: 'C:\\Compta' })
  )
}

const has = (s: LabState, name: string, path: string) => !!findNode(server(s, name).storage, path)
const create = (s: LabState, name: string, path: string, kind: 'file' | 'folder' = 'file') =>
  exec(
    s,
    command('files.createItem', id(s, name), path, kind, domainToken(s.domains[D]!, 'Administrateur')!, {})
  )

describe('DFS', () => {
  it('espace de noms : \\\\lab.local\\Partages\\Compta mène à la cible en ligne', () => {
    let s = lab()
    const srv1 = id(s, 'SRV1')
    s = exec(
      s,
      command('dfs.newNamespace', srv1, { name: 'Partages', createShare: true }),
      command('dfs.newFolder', '\\\\lab.local\\Partages\\Compta', '\\\\SRV1\\Compta'),
      command('dfs.addTarget', '\\\\lab.local\\Partages\\Compta', '\\\\SRV2\\Compta')
    )
    // La racine contient le dossier (point d'analyse) et est partagée
    expect(has(s, 'SRV1', 'C:\\DFSRoots\\Partages\\Compta')).toBe(true)
    const token = domainToken(s.domains[D]!, 'jdupont')!
    const pc1 = id(s, 'PC1')
    const viaNs = openUnc(s, pc1, '\\\\lab.local\\Partages\\Compta', token)
    expect(viaNs.ok && viaNs.target.server.name).toBe('SRV1')
    // SRV1 éteint : la référence désigne SRV2
    const off = unwrap(setPower(s, srv1, false)).state
    const failover = openUnc(off, pc1, '\\\\lab.local\\Partages\\Compta', token)
    expect(failover.ok && failover.target.server.name).toBe('SRV2')
    const root = openUnc(s, pc1, '\\\\lab.local\\Partages', token)
    expect(root.ok && root.target.localPath).toBe('C:\\DFSRoots\\Partages')
    expect(
      evaluateCheck(s, {
        type: 'dfsNamespace',
        domain: 'lab.local',
        name: 'Partages',
        folder: 'Compta',
        targets: 2
      })
    ).toBe(true)
    // Accès avec la session ouverte sur le poste
    const check = { type: 'uncReachable', from: 'PC1', path: '\\\\lab.local\\Partages\\Compta' }
    expect(evaluateCheck(s, check)).toBe(false)
    s = exec(s, command('adds.logon', pc1, { user: 'jdupont', password: 'Azerty123!', domain: 'LAB' }))
    expect(evaluateCheck(s, check)).toBe(true)
    // Erreurs : cible inexistante, dossier en double
    const bad = dispatch(s, command('dfs.newFolder', '\\\\lab.local\\Partages\\RH', '\\\\SRV1\\RH'))
    expect(!bad.ok && bad.error.code).toBe('TargetNotFound')
    const dup = dispatch(s, command('dfs.newFolder', '\\\\lab.local\\Partages\\Compta', '\\\\SRV1\\Compta'))
    expect(!dup.ok && dup.error.code).toBe('FolderExists')
  })

  it('acceptation : un fichier créé sur un serveur apparaît sur l’autre (réplication en tâche de fond)', () => {
    let s = replicated(lab())
    s = create(s, 'SRV1', 'C:\\Compta\\budget.xlsx')
    expect(has(s, 'SRV2', 'C:\\Compta\\budget.xlsx')).toBe(false)
    s = runBackgroundTasks(s).state
    expect(has(s, 'SRV2', 'C:\\Compta\\budget.xlsx')).toBe(true)
    // Dans l'autre sens, dossiers compris
    s = create(s, 'SRV2', 'C:\\Compta\\2026', 'folder')
    s = create(s, 'SRV2', 'C:\\Compta\\2026\\bilan.docx')
    s = runBackgroundTasks(s).state
    expect(has(s, 'SRV1', 'C:\\Compta\\2026\\bilan.docx')).toBe(true)
    // Point fixe : un second passage ne change rien
    expect(runBackgroundTasks(s).state).toBe(s)
    expect(
      evaluateCheck(s, {
        type: 'dfsReplicated',
        group: 'Compta',
        server: 'SRV2',
        path: 'C:\\Compta\\budget.xlsx'
      })
    ).toBe(true)
  })

  it('suppressions propagées ; membre hors ligne rattrapé sans perte', () => {
    let s = replicated(lab())
    s = create(s, 'SRV1', 'C:\\Compta\\a.txt')
    s = runBackgroundTasks(s).state
    s = exec(
      s,
      command(
        'files.removeItem',
        id(s, 'SRV2'),
        'C:\\Compta\\a.txt',
        domainToken(s.domains[D]!, 'Administrateur')!,
        {}
      )
    )
    s = runBackgroundTasks(s).state
    expect(has(s, 'SRV1', 'C:\\Compta\\a.txt')).toBe(false)
    // SRV2 éteint : un ajout sur SRV1 attend son retour, sans être supprimé
    s = unwrap(setPower(s, id(s, 'SRV2'), false)).state
    s = create(s, 'SRV1', 'C:\\Compta\\b.txt')
    s = runBackgroundTasks(s).state
    expect(has(s, 'SRV1', 'C:\\Compta\\b.txt')).toBe(true)
    s = unwrap(setPower(s, id(s, 'SRV2'), true)).state
    s = runBackgroundTasks(s).state
    expect(has(s, 'SRV2', 'C:\\Compta\\b.txt')).toBe(true)
    expect(has(s, 'SRV1', 'C:\\Compta\\b.txt')).toBe(true)
  })

  it('réplication initiale : le membre principal fait autorité ; « Répliquer maintenant »', () => {
    let s = lab()
    s = create(s, 'SRV1', 'C:\\Compta\\commun.txt')
    s = create(s, 'SRV2', 'C:\\Compta\\local.txt')
    s = replicated(s)
    s = exec(s, command('dfs.sync', 'Compta'))
    expect(has(s, 'SRV2', 'C:\\Compta\\commun.txt')).toBe(true)
    expect(has(s, 'SRV1', 'C:\\Compta\\local.txt')).toBe(true)
    const notMember = dispatch(
      s,
      command('dfs.setMembership', 'Compta', 'Compta', 'SRV1', { contentPath: 'Compta' })
    )
    expect(!notMember.ok && notMember.error.code).toBe('InvalidPath')
  })

  it('cmdlets DFSN et DFSR : même état que la console', () => {
    let s = lab()
    const srv1 = id(s, 'SRV1')
    s = exec(s, command('dfs.newNamespace', srv1, { name: 'Partages', createShare: true }))
    // Espace de noms déjà créé : New-DfsnRoot sur une autre racine exige un partage existant
    const noShare = run(
      s,
      srv1,
      'New-DfsnRoot -Path \\\\lab.local\\Data -TargetPath \\\\SRV1\\Data -Type DomainV2'
    )
    expect(noShare.errors).toMatch(/n’existe pas/)
    s = run(
      s,
      srv1,
      'New-DfsnFolder -Path \\\\lab.local\\Partages\\Compta -TargetPath \\\\SRV1\\Compta'
    ).state
    s = run(
      s,
      srv1,
      'New-DfsnFolderTarget -Path \\\\lab.local\\Partages\\Compta -TargetPath \\\\SRV2\\Compta'
    ).state
    expect(run(s, srv1, 'Get-DfsnFolderTarget -Path \\\\lab.local\\Partages\\Compta').text).toContain(
      '\\\\SRV2\\Compta'
    )
    expect(run(s, srv1, 'Get-DfsnFolder -Path \\\\lab.local\\Partages\\*').text).toContain(
      '\\\\lab.local\\Partages\\Compta'
    )
    expect(run(s, srv1, 'Get-DfsnRoot').text).toContain('\\\\lab.local\\Partages')
    s = run(s, srv1, 'New-DfsReplicationGroup -GroupName Compta').state
    s = run(s, srv1, 'Add-DfsrMember -GroupName Compta -ComputerName SRV1,SRV2').state
    s = run(s, srv1, 'New-DfsReplicatedFolder -GroupName Compta -FolderName Compta').state
    s = run(
      s,
      srv1,
      'Set-DfsrMembership -GroupName Compta -FolderName Compta -ComputerName SRV1 -ContentPath C:\\Compta -PrimaryMember $true -Force'
    ).state
    s = run(
      s,
      srv1,
      'Set-DfsrMembership -GroupName Compta -FolderName Compta -ComputerName SRV2 -ContentPath C:\\Compta -Force'
    ).state
    expect(run(s, srv1, 'Get-DfsrMembership -GroupName Compta').text).toMatch(
      /SRV1\s+Compta\s+C:\\Compta\s+True/
    )
    s = create(s, 'SRV1', 'C:\\Compta\\ps.txt')
    s = run(s, srv1, 'Sync-DfsReplicationGroup -GroupName Compta -DurationInMinutes 5').state
    expect(has(s, 'SRV2', 'C:\\Compta\\ps.txt')).toBe(true)
    s = run(
      s,
      srv1,
      'Remove-DfsnFolderTarget -Path \\\\lab.local\\Partages\\Compta -TargetPath \\\\SRV2\\Compta -Force'
    ).state
    s = run(s, srv1, 'Remove-DfsnFolder -Path \\\\lab.local\\Partages\\Compta -Force').state
    s = run(s, srv1, 'Remove-DfsReplicationGroup -GroupName Compta -Force').state
    s = run(s, srv1, 'Remove-DfsnRoot -Path \\\\lab.local\\Partages -Force').state
    expect(run(s, srv1, 'Get-DfsnRoot').text.trim()).toBe('')
  })
})
