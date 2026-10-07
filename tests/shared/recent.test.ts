/**
 * Fichiers récents : nom et dossier d'un chemin, date d'ouverture lisible, liste tenue à jour
 * (ouverture, retrait) — logique partagée par le process principal et l'écran d'accueil.
 */
import { describe, expect, it } from 'vitest'
import type { RecentFile } from '../../src/shared/ipc'
import { MAX_RECENT } from '../../src/shared/persisted'
import { forgetRecent, formatOpenedAt, rememberRecent, splitPath } from '../../src/shared/recent'

describe('nom et dossier d’un chemin', () => {
  it('chemins Windows et Linux', () => {
    expect(splitPath('C:\\Users\\gary\\Labs\\dhcp.slab')).toEqual({
      name: 'dhcp.slab',
      folder: 'C:\\Users\\gary\\Labs'
    })
    expect(splitPath('/home/gary/labs/dns.slab')).toEqual({ name: 'dns.slab', folder: '/home/gary/labs' })
  })

  it('fichier à la racine : le dossier est la racine', () => {
    expect(splitPath('C:\\lab.slab')).toEqual({ name: 'lab.slab', folder: 'C:\\' })
    expect(splitPath('/lab.slab')).toEqual({ name: 'lab.slab', folder: '/' })
    expect(splitPath('lab.slab')).toEqual({ name: 'lab.slab', folder: '' })
  })
})

describe('date de dernière ouverture', () => {
  // Heures locales : le résultat ne dépend pas du fuseau de la machine de test
  const now = new Date(2026, 9, 6, 15, 30)
  const at = (...args: [number, number, number, number, number]) => new Date(...args).toISOString()

  it('aujourd’hui et hier : heure seule', () => {
    expect(formatOpenedAt(at(2026, 9, 6, 14, 5), now, 'fr')).toBe('Aujourd’hui, 14:05')
    expect(formatOpenedAt(at(2026, 9, 6, 0, 0), now, 'fr')).toBe('Aujourd’hui, 00:00')
    expect(formatOpenedAt(at(2026, 9, 5, 9, 12), now, 'fr')).toBe('Hier, 09:12')
    expect(formatOpenedAt(at(2026, 9, 5, 23, 59), now, 'fr')).toBe('Hier, 23:59')
  })

  it('en anglais : Today / Yesterday, date courte', () => {
    expect(formatOpenedAt(at(2026, 9, 6, 14, 5), now, 'en')).toBe('Today, 14:05')
    expect(formatOpenedAt(at(2026, 9, 5, 9, 12), now, 'en')).toBe('Yesterday, 09:12')
    expect(formatOpenedAt(at(2026, 9, 3, 10, 0), now, 'en')).toBe('3 Oct 2026')
  })

  it('plus ancien : date courte', () => {
    expect(formatOpenedAt(at(2026, 9, 3, 10, 0), now, 'fr')).toBe('3 oct. 2026')
    expect(formatOpenedAt(at(2025, 11, 31, 10, 0), now, 'fr')).toBe('31 déc. 2025')
  })

  it('hier en début de mois et d’année', () => {
    expect(formatOpenedAt(at(2026, 8, 30, 8, 0), new Date(2026, 9, 1, 9, 0), 'fr')).toBe('Hier, 08:00')
    expect(formatOpenedAt(at(2025, 11, 31, 8, 0), new Date(2026, 0, 1, 9, 0), 'fr')).toBe('Hier, 08:00')
  })

  it('date illisible : rien d’affiché', () => {
    expect(formatOpenedAt('', now, 'fr')).toBe('')
    expect(formatOpenedAt('pas une date', now, 'fr')).toBe('')
  })
})

describe('liste des récents', () => {
  const file = (path: string, openedAt = '2026-10-06T10:00:00Z'): RecentFile => ({
    path,
    name: splitPath(path).name,
    openedAt
  })
  const exact = (p: string) => p
  // Comme sous Windows : chemins comparés sans tenir compte de la casse
  const windows = (p: string) => p.toLowerCase()

  it('le fichier ouvert passe en tête, sans doublon', () => {
    const list = [file('C:\\a.slab'), file('C:\\b.slab'), file('C:\\c.slab')]
    const reopened = file('C:\\b.slab', '2026-10-06T12:00:00Z')
    expect(rememberRecent(list, reopened, exact)).toEqual([reopened, list[0], list[2]])
  })

  it('même fichier avec une autre casse : une seule entrée sous Windows', () => {
    const list = [file('C:\\Labs\\A.slab')]
    expect(rememberRecent(list, file('c:\\labs\\a.slab'), windows)).toHaveLength(1)
    expect(rememberRecent(list, file('c:\\labs\\a.slab'), exact)).toHaveLength(2)
  })

  it('liste limitée aux plus récents', () => {
    const list = Array.from({ length: MAX_RECENT }, (_, i) => file(`/labs/${i}.slab`))
    const next = rememberRecent(list, file('/labs/nouveau.slab'), exact)
    expect(next).toHaveLength(MAX_RECENT)
    expect(next[0]?.path).toBe('/labs/nouveau.slab')
    expect(next.some((r) => r.path === `/labs/${MAX_RECENT - 1}.slab`)).toBe(false)
  })

  it('retirer une entrée garde les autres dans le même ordre', () => {
    const list = [file('C:\\a.slab'), file('C:\\Disparu.slab'), file('C:\\c.slab')]
    expect(forgetRecent(list, 'c:\\disparu.slab', windows)).toEqual([list[0], list[2]])
    expect(forgetRecent(list, 'C:\\inconnu.slab', windows)).toEqual(list)
  })
})
