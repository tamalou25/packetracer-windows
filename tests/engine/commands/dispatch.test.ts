/**
 * Commandes nommées : dispatch unique, libellés français, journal avec patches, lots, adaptateurs
 * des actions à forme spéciale et rejeu déterministe d'un scénario complet (GUI + console).
 */
import { describe, expect, it } from 'vitest'
import {
  applyStatePatches,
  batch,
  command,
  createLab,
  createShellSession,
  dispatch,
  replay,
  type AnyCommand,
  type DispatchResult,
  type ShellOutcome,
  type JournalEntry,
  type LabState
} from '@engine/index'

const id = (s: LabState, name: string) => Object.values(s.devices).find((d) => d.name === name)?.id ?? ''
const iface = (s: LabState, name: string, index = 0) => s.devices[id(s, name)]?.interfaces[index]?.id ?? ''

/** Exécute des commandes en les enregistrant, comme le ferait l'interface. */
class Session {
  state: LabState
  readonly commands: (AnyCommand & { label?: string })[] = []
  readonly journal: JournalEntry[] = []
  constructor(readonly initial: LabState) {
    this.state = initial
  }
  run(cmd: AnyCommand & { label?: string }) {
    const r = dispatch(this.state, cmd)
    if (!r.ok) throw new Error(`${cmd.type} : ${r.error.message}`)
    this.commands.push(cmd)
    if (r.entry) this.journal.push(r.entry)
    this.state = r.state
    return r
  }
  shell(device: string, line: string, answers: string[] = []) {
    const session = createShellSession(this.state, id(this.state, device), 'powershell')
    return this.run(command('shell.exec', session, line, answers)) as DispatchResult<ShellOutcome>
  }
}

/** Scénario complet : topologie, IP, rôles (GUI et console), domaine, jonction, session, lot. */
function scenario(): Session {
  const s = new Session(createLab())
  s.run(command('topology.addDevice', { kind: 'server', position: { x: 0, y: 0 }, name: 'SRV1' }))
  s.run(command('topology.addDevice', { kind: 'switch', position: { x: 200, y: 0 }, name: 'SW1' }))
  s.run(command('topology.addDevice', { kind: 'client', position: { x: 400, y: 0 }, name: 'PC1' }))
  for (const [name, port] of [
    ['SRV1', 0],
    ['PC1', 1]
  ] as const)
    s.run(
      command(
        'topology.connect',
        { deviceId: id(s.state, name), ifaceId: iface(s.state, name) },
        { deviceId: id(s.state, 'SW1'), ifaceId: iface(s.state, 'SW1', port) }
      )
    )
  s.run(
    command('net.setInterfaceIpv4', id(s.state, 'SRV1'), iface(s.state, 'SRV1'), {
      addressing: 'static',
      address: '192.168.10.1',
      mask: '24',
      gateway: null,
      dnsServers: ['192.168.10.1']
    })
  )
  s.run(
    command('net.setInterfaceIpv4', id(s.state, 'PC1'), iface(s.state, 'PC1'), {
      addressing: 'static',
      address: '192.168.10.10',
      mask: '24',
      gateway: null,
      dnsServers: ['192.168.10.1']
    })
  )
  s.shell('SRV1', 'Install-WindowsFeature AD-Domain-Services -IncludeManagementTools')
  s.run(
    command('adds.installForest', id(s.state, 'SRV1'), {
      domainName: 'lab.local',
      safeModePassword: 'P@ssw0rd!'
    })
  )
  s.run(command('system.restartComputer', id(s.state, 'SRV1')))
  s.shell('SRV1', 'New-ADOrganizationalUnit -Name Compta')
  s.run(
    batch('Créer jdupont dans GG_Compta', [
      command('adds.addUser', 'lab.local', {
        name: 'Jean Dupont',
        sam: 'jdupont',
        path: 'OU=Compta,DC=lab,DC=local',
        password: 'Azerty123!',
        enabled: true
      }),
      command('adds.addGroup', 'lab.local', { name: 'GG_Compta', scope: 'Global' }),
      command('adds.addGroupMembers', 'lab.local', 'GG_Compta', ['jdupont'])
    ])
  )
  const dc = s.state.devices[id(s.state, 'SRV1')]
  const password = dc?.kind === 'server' ? dc.host.localAdminPassword : ''
  s.run(
    command('adds.joinDomain', id(s.state, 'PC1'), {
      domain: 'lab.local',
      user: 'LAB\\Administrateur',
      password
    })
  )
  s.run(command('system.restartComputer', id(s.state, 'PC1')))
  s.run(command('background.tick'))
  s.run(command('adds.logon', id(s.state, 'PC1'), { user: 'jdupont', password: 'Azerty123!', domain: 'LAB' }))
  return s
}

describe('dispatch', () => {
  it('exécute la commande et produit une entrée de journal (libellé, heure, patches)', () => {
    const r = dispatch(
      createLab(),
      command('topology.addDevice', { kind: 'server', position: { x: 0, y: 0 }, name: 'SRV1' })
    )
    expect(r.ok).toBe(true)
    expect(r.entry).toMatchObject({ type: 'topology.addDevice', label: 'Ajouter SRV1', time: 0 })
    expect(r.entry?.patches.length).toBeGreaterThan(0)
  })

  it('erreur métier : message français, aucune entrée de journal', () => {
    const r = dispatch(createLab(), command('topology.renameDevice', 'inexistant', 'SRV2'))
    expect(r.ok).toBe(false)
    expect(r.entry).toBeNull()
    if (!r.ok) expect(r.error.message).toMatch(/introuvable/i)
  })

  it('commande inconnue (fichier ou version future) : refusée proprement', () => {
    const r = dispatch(createLab(), { type: 'system.formatDisk', args: [] })
    expect(r.ok).toBe(false)
    if (!r.ok)
      expect(r.error).toEqual({ code: 'UnknownCommand', message: 'Commande inconnue : system.formatDisk.' })
  })

  it('libellés lisibles à partir de l’état d’avant', () => {
    const s = scenario()
    const labels = s.journal.map((e) => e.label)
    expect(labels).toContain('Câbler SRV1 Ethernet0 ↔ SW1 Fa0/1')
    expect(labels).toContain('Promouvoir SRV1 (forêt lab.local)')
    expect(labels).toContain('Créer jdupont dans GG_Compta')
    expect(labels).toContain('Joindre PC1 au domaine lab.local')
    expect(labels).toContain('New-ADOrganizationalUnit -Name Compta sur SRV1')
  })

  it('un lot échoue en entier : aucune sous-commande n’est appliquée', () => {
    const base = scenario().state
    const r = dispatch(
      base,
      batch('Lot invalide', [
        command('adds.addOrganizationalUnit', 'lab.local', { name: 'Direction' }),
        command('adds.addGroupMembers', 'lab.local', 'GroupeInexistant', ['jdupont'])
      ])
    )
    expect(r.ok).toBe(false)
  })
})

describe('adaptateurs des actions à forme spéciale', () => {
  it('ouverture de session refusée : l’échec est journalisé (évènement 4625) et signalé', () => {
    const s = scenario()
    const r = dispatch(
      s.state,
      command('adds.logon', id(s.state, 'PC1'), { user: 'jdupont', password: 'faux', domain: 'LAB' })
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.success).toBe(false)
    expect(r.value.message).toMatch(/incorrect/)
    expect(r.entry).not.toBeNull()
  })

  it('lecteur réseau introuvable : erreur système normalisée', () => {
    const s = scenario()
    const r = dispatch(
      s.state,
      command('files.mapDrive', id(s.state, 'PC1'), 'S', '\\\\INCONNU\\Partage', null, { persistent: false })
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toMatch(/^SystemError\d+$/)
  })

  it('console : la sortie est renvoyée, l’état suit la commande', () => {
    const s = scenario()
    const r = s.shell('SRV1', 'Get-ADUser -Identity jdupont')
    expect(r.ok && r.value.output.map((l) => l.text).join('\n')).toContain('jdupont')
  })
})

describe('journal', () => {
  it('rejouer les commandes depuis l’état initial redonne exactement le même état', () => {
    const s = scenario()
    // Commandes sérialisées puis relues, comme depuis un fichier
    const commands = JSON.parse(JSON.stringify(s.commands)) as AnyCommand[]
    const r = replay(s.initial, commands)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.state).toEqual(s.state)
      expect(r.value.map((e) => e.label)).toEqual(s.journal.map((e) => e.label))
    }
  })

  it('annuler toutes les entrées (inverses) ramène à l’état initial, les rétablir à l’état final', () => {
    const s = scenario()
    let state = s.state
    for (const entry of [...s.journal].reverse()) state = applyStatePatches(state, entry.inversePatches)
    expect(state).toEqual(s.initial)
    for (const entry of s.journal) state = applyStatePatches(state, entry.patches)
    expect(state).toEqual(s.state)
  })

  it('les entrées sont sérialisables (JSON)', () => {
    const s = scenario()
    const copy = JSON.parse(JSON.stringify(s.journal)) as JournalEntry[]
    let state = s.state
    for (const entry of [...copy].reverse()) state = applyStatePatches(state, entry.inversePatches)
    expect(state).toEqual(s.initial)
  })
})
