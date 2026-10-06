/**
 * Logique fournie par le moteur aux fenêtres de l'interface (aucun calcul métier dans un
 * composant) : cases NTFS de l'onglet Sécurité, partages d'un dossier, ports utilisés d'un
 * switch, domaine dont un serveur est contrôleur.
 */
import { describe, expect, it } from 'vitest'
import {
  controlledDomain,
  createItem,
  createShare,
  expandNtfsRights,
  findNode,
  localToken,
  sharesCovering,
  sharesOn,
  toggleNtfsRight,
  unwrap,
  usedInterfaces,
  type ServerDevice
} from '@engine/index'
import { build, cable, setIp } from '../helpers'
import { run } from '../shell/helpers'

describe('autorisations NTFS de base (onglet Sécurité)', () => {
  it('une autorisation coche celles qu’elle inclut', () => {
    expect([...expandNtfsRights(['Modify'])].sort()).toEqual(
      ['ListDirectory', 'Modify', 'Read', 'ReadAndExecute', 'Write'].sort()
    )
    expect(expandNtfsRights(['FullControl']).size).toBe(6)
    expect(expandNtfsRights([]).size).toBe(0)
  })

  it('cocher ajoute les inclusions, décocher retire ce qui inclut le droit', () => {
    expect(toggleNtfsRight(new Set(), 'ReadAndExecute', true).sort()).toEqual(
      ['ListDirectory', 'Read', 'ReadAndExecute'].sort()
    )
    const full = expandNtfsRights(['FullControl'])
    expect(toggleNtfsRight(full, 'Read', false).sort()).toEqual(['ListDirectory', 'Write'].sort())
  })

  it('tout cocher revient à Contrôle total', () => {
    const almost = expandNtfsRights(['Modify'])
    expect(toggleNtfsRight(almost, 'FullControl', true)).toContain('FullControl')
    const rest = new Set(expandNtfsRights(['Modify']))
    expect(toggleNtfsRight(rest, 'Write', true)).not.toContain('FullControl')
  })
})

describe('partages d’un dossier', () => {
  it('partage du dossier lui-même, et partages couvrant un sous-dossier', () => {
    const { state, ids } = build([['server', 'SRV1']])
    const admin = localToken('SRV1', 'Administrateur')
    let s = unwrap(
      createItem(state, ids.SRV1!, 'C:\\Partages\\Compta\\Budget', 'folder', admin, { parents: true })
    ).state
    s = unwrap(createShare(s, ids.SRV1!, { name: 'Partages', path: 'C:\\Partages' }, admin)).state
    s = unwrap(createShare(s, ids.SRV1!, { name: 'Compta', path: 'C:\\Partages\\Compta' }, admin)).state
    const storage = (s.devices[ids.SRV1!] as ServerDevice).storage
    const id = (path: string) => findNode(storage, path)?.id ?? null
    expect(sharesOn(storage, id('C:\\Partages\\Compta')).map((x) => x.name)).toEqual(['Compta'])
    expect(sharesOn(storage, id('C:\\Partages\\Compta\\Budget'))).toEqual([])
    expect(
      sharesCovering(storage, id('C:\\Partages\\Compta\\Budget'))
        .map((x) => x.name)
        .sort()
    ).toEqual(['Compta', 'Partages'])
    expect(sharesCovering(storage, null)).toEqual([])
  })
})

describe('propriétés d’équipement', () => {
  it('ports utilisés d’un switch', () => {
    const { state, ids } = build([
      ['switch', 'SW1'],
      ['client', 'PC1'],
      ['client', 'PC2']
    ])
    let s = cable(state, ids.PC1!, 0, ids.SW1!, 0)
    s = cable(s, ids.PC2!, 0, ids.SW1!, 3)
    expect(usedInterfaces(s, ids.SW1!).map((i) => i.name)).toEqual(['Fa0/1', 'Fa0/4'])
    expect(usedInterfaces(s, 'inconnu')).toEqual([])
  })

  it('domaine dont un serveur est contrôleur', () => {
    const { state, ids } = build([
      ['server', 'SRV1'],
      ['server', 'SRV2']
    ])
    let s = setIp(state, ids.SRV1!, 0, '192.168.1.1/24')
    s = run(s, ids.SRV1!, 'Install-WindowsFeature AD-Domain-Services -IncludeManagementTools').state
    s = run(s, ids.SRV1!, 'Install-ADDSForest -DomainName lab.local -InstallDns', {
      answers: ['P@ssw0rd!', 'P@ssw0rd!', 'O']
    }).state
    expect(controlledDomain(s, ids.SRV1!)?.name).toBe('lab.local')
    expect(controlledDomain(s, ids.SRV2!)).toBeUndefined()
  })
})
