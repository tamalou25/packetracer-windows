/**
 * Journaux de sécurité : évènements 4624, 4625, 4672, 4720, 4728/4729 générés au bon moment,
 * filtre de l'Observateur (filterEvents), Get-WinEvent et tables de hachage PowerShell.
 */
import { describe, expect, it } from 'vitest'
import {
  command,
  dispatch,
  filterEvents,
  formatShortDate,
  parseLabDate,
  type HostDevice,
  type LabState
} from '@engine/index'
import { buildReferenceLab } from '../serialization/reference-lab'
import { run } from './helpers'

const id = (s: LabState, name: string) => Object.values(s.devices).find((d) => d.name === name)?.id ?? ''
const log = (s: LabState, name: string) => (s.devices[id(s, name)] as HostDevice).host.eventLog
const ids = (s: LabState, name: string) =>
  log(s, name)
    .filter((e) => e.log === 'Sécurité')
    .map((e) => e.eventId)

function logon(s: LabState, device: string, user: string, password: string, domain: string | null = 'LAB') {
  const r = dispatch(s, command('adds.logon', id(s, device), { user, password, domain }))
  if (!r.ok) throw new Error(r.error.message)
  return r.state
}

describe('Évènements de sécurité', () => {
  it('ouverture de session : 4625 (échec), 4624 (succès), 4672 pour un administrateur seulement', () => {
    let s = buildReferenceLab()
    s = logon(s, 'PC1', 'jdupont', 'faux')
    expect(ids(s, 'PC1')).toContain(4625)
    const before = ids(s, 'PC1').length
    s = logon(s, 'PC1', 'jdupont', 'Azerty123!')
    expect(ids(s, 'PC1').slice(before)).toEqual([4624])
    const n = ids(s, 'PC1').length
    s = logon(s, 'PC1', 'Administrateur', 'P@ssw0rd')
    expect(ids(s, 'PC1').slice(n)).toEqual([4624, 4672])
    const special = log(s, 'PC1').find((e) => e.eventId === 4672)
    expect(special?.message).toContain('Compte : LAB\\Administrateur')
    // Compte local : 4625 puis 4624 et 4672
    const m = ids(s, 'PC2').length
    s = logon(s, 'PC2', 'Administrateur', 'faux', null)
    s = logon(s, 'PC2', 'Administrateur', 'P@ssw0rd', null)
    expect(ids(s, 'PC2').slice(m)).toEqual([4625, 4624, 4672])
  })

  it('gestion des comptes : 4720 (création), 4728 / 4729 (groupe global), 4732 (groupe local)', () => {
    let s = buildReferenceLab()
    const srv = id(s, 'SRV1')
    const start = log(s, 'SRV1').length
    s = run(
      s,
      srv,
      "New-ADUser -Name mmartin -AccountPassword (ConvertTo-SecureString 'Azerty123!' -AsPlainText -Force) -Enabled $true"
    ).state
    s = run(s, srv, 'Add-ADGroupMember -Identity GG_Compta -Members mmartin').state
    s = run(s, srv, 'Remove-ADGroupMember -Identity GG_Compta -Members mmartin -Confirm:$false').state
    s = run(s, srv, 'Add-ADGroupMember -Identity Administrateurs -Members mmartin').state
    const events = log(s, 'SRV1')
      .slice(start)
      .filter((e) => [4720, 4728, 4729, 4732].includes(e.eventId))
    expect(events.map((e) => e.eventId)).toEqual([4720, 4728, 4729, 4732])
    expect(events[1]?.message).toContain('Membre : LAB\\mmartin. Groupe : LAB\\GG_Compta')
  })
})

describe('Filtrage des journaux', () => {
  it('filterEvents : ID, niveau, source, période', () => {
    let s = buildReferenceLab()
    s = logon(s, 'PC1', 'jdupont', 'faux')
    s = logon(s, 'PC1', 'jdupont', 'Azerty123!')
    const entries = log(s, 'PC1')
    expect(filterEvents(entries, { ids: [4625] }).every((e) => e.eventId === 4625)).toBe(true)
    expect(filterEvents(entries, { levels: ['warning'] }).map((e) => e.eventId)).toContain(4625)
    expect(filterEvents(entries, { sources: ['security'] }).length).toBeGreaterThan(0)
    const last = entries[entries.length - 1]!.time
    expect(filterEvents(entries, { since: last }).length).toBe(1)
    expect(filterEvents(entries, { until: -1 })).toEqual([])
  })

  it('Get-WinEvent -FilterHashtable, -MaxEvents, aucun évènement', () => {
    let s = buildReferenceLab()
    s = logon(s, 'PC1', 'jdupont', 'faux')
    s = logon(s, 'PC1', 'jdupont', 'faux')
    const pc1 = id(s, 'PC1')
    const failed = run(s, pc1, "Get-WinEvent -FilterHashtable @{LogName='Security'; Id=4625}")
    expect(failed.text.match(/4625/g)).toHaveLength(2)
    expect(
      run(
        s,
        pc1,
        "Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4625 } -MaxEvents 1"
      ).text.match(/4625/g)
    ).toHaveLength(1)
    expect(run(s, pc1, "Get-WinEvent -FilterHashtable @{LogName='Security'; Level=3}").text).toContain(
      'Avertissement'
    )
    const start = formatShortDate(s.clock + 60_000)
    expect(
      run(s, pc1, `Get-WinEvent -FilterHashtable @{LogName='Security'; StartTime='${start}'}`).errors
    ).toContain('Aucun événement correspondant')
    expect(run(s, pc1, 'Get-WinEvent -LogName Security -MaxEvents 1').text).toContain('4625')
    expect(run(s, pc1, 'Get-WinEvent -LogName Inconnu').errors).toContain('Aucun journal')
  })

  it('tables de hachage : @{ clé = valeur } et accès aux propriétés', () => {
    const s = buildReferenceLab()
    const r = run(s, id(s, 'SRV1'), "$h = @{ Nom = 'SRV1'; Ports = 80,443 }; $h.Ports")
    expect(r.text).toContain('443')
    expect(parseLabDate('05/01/2026 09:30')).toBe(90 * 60_000)
    expect(parseLabDate('2026-01-05')).toBe(-8 * 3_600_000)
    expect(parseLabDate('hier')).toBeNull()
  })
})
