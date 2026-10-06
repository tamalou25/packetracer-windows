/**
 * Expressions PowerShell (Where-Object et -Filter) : opérateurs de comparaison, logiques, négation,
 * parenthèses et erreurs de syntaxe, sur les comptes du lab de référence.
 */
import { describe, expect, it } from 'vitest'
import type { LabState } from '@engine/index'
import { buildReferenceLab } from '../serialization/reference-lab'
import { run } from './helpers'

const id = (s: LabState, name: string) => Object.values(s.devices).find((d) => d.name === name)?.id ?? ''

/** Noms des comptes retenus par un filtre Where-Object (dans l'ordre de Get-ADUser). */
function names(filter: string): string[] {
  const s = buildReferenceLab()
  const r = run(s, id(s, 'SRV1'), `Get-ADUser -Filter * | Where-Object { ${filter} } | Select-Object Name`)
  if (r.errors) throw new Error(r.errors)
  return r.text
    .split('\n')
    .slice(3)
    .map((l) => l.trim())
    .filter(Boolean)
}

/** Erreur produite par un filtre Where-Object. */
function error(filter: string): string {
  const s = buildReferenceLab()
  return run(s, id(s, 'SRV1'), `Get-ADUser -Filter * | Where-Object { ${filter} }`).errors
}

const ALL = ['Administrateur', 'Invité', 'krbtgt', 'Jean Dupont']

describe('expressions PowerShell', () => {
  it('-eq, -ne, -like, -notlike, -match, -notmatch (insensibles à la casse)', () => {
    expect(names("$_.Name -eq 'KRBTGT'")).toEqual(['krbtgt'])
    expect(names("$_.Name -ne 'krbtgt'")).toEqual(['Administrateur', 'Invité', 'Jean Dupont'])
    expect(names("$_.Name -like '*an*'")).toEqual(['Jean Dupont'])
    expect(names("$_.Name -notlike 'a*'")).toEqual(['Invité', 'krbtgt', 'Jean Dupont'])
    expect(names("$_.Name -match '^[a-j]'")).toEqual(['Administrateur', 'Invité', 'Jean Dupont'])
    expect(names("$_.Name -notmatch '^[A-J]'")).toEqual(['krbtgt'])
  })

  it('-and, -or, -not, ! et parenthèses', () => {
    expect(names("$_.Name -like '*an*' -and -not ($_.Enabled -eq $false)")).toEqual(['Jean Dupont'])
    expect(names("$_.Name -eq 'krbtgt' -or $_.Name -eq 'Invité'")).toEqual(['Invité', 'krbtgt'])
    expect(names('! $_.Enabled')).toEqual(['Invité', 'krbtgt'])
    expect(names("$_.Name -notlike 'A*' -or $_.Enabled")).toEqual(ALL)
  })

  it('comparaisons numériques : -gt, -ge, -lt, -le', () => {
    const s = buildReferenceLab()
    const r = run(
      s,
      id(s, 'SRV1'),
      'Get-ADGroup -Filter * | Measure-Object | Where-Object { $_.Count -gt 10 -and $_.Count -le 12 -and $_.Count -ge 12 -and $_.Count -lt 13 } | Select-Object Count'
    )
    expect(r.text).toMatch(/\b12\b/)
    // Valeurs non numériques : ordre alphabétique
    expect(names("$_.Name -lt 'B'")).toEqual(['Administrateur'])
  })

  it('-Filter de Get-ADUser : mêmes opérateurs', () => {
    const s = buildReferenceLab()
    const r = run(s, id(s, 'SRV1'), 'Get-ADUser -Filter "Name -like \'J*\'" | Select-Object Name')
    expect(r.text).toContain('Jean Dupont')
    expect(r.text).not.toContain('krbtgt')
  })

  it('erreurs de syntaxe : parenthèse manquante, expression manquante, jeton en trop', () => {
    expect(error("($_.Name -eq 'krbtgt'")).toContain('Parenthèse fermante « ) » manquante')
    expect(error('$_.Name -eq')).toContain('Expression manquante')
    expect(error("$_.Name -eq 'a' 'b'")).toContain("Jeton inattendu « 'b' »")
  })
})
