/**
 * Bibliothèque de labs : SHA-256 (vecteurs de test FIPS 180-4), index validé strictement,
 * lab téléchargé vérifié (empreinte, schéma, identifiant).
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseLibraryIndex, sha256, utf8Bytes, verifyLibraryLab, type LibraryEntry } from '@engine/index'
import lab1 from '../../../labs/lab-01-adressage.json'

const LAB_TEXT = `${JSON.stringify(lab1, null, 2)}\n`

const entry = (overrides: Partial<LibraryEntry> = {}): LibraryEntry => ({
  id: 'lab-01-adressage',
  title: 'Adressage IP et routage',
  author: 'Gary',
  difficulty: 'Débutant',
  version: '1.0.0',
  summary: '',
  file: 'labs/lab-01-adressage.json',
  sha256: createHash('sha256').update(LAB_TEXT, 'utf8').digest('hex'),
  ...overrides
})

describe('SHA-256', () => {
  it('vecteurs de test FIPS 180-4', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
    )
    expect(sha256('a'.repeat(1_000_000))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'
    )
  })

  it('texte UTF-8 (accents, émoticônes) : identique à node:crypto', () => {
    for (const text of ['Éditeur de labs — « été »', '😀 Ω', LAB_TEXT])
      expect(sha256(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'))
    expect([...utf8Bytes('é')]).toEqual([0xc3, 0xa9])
  })
})

describe('Index de la bibliothèque', () => {
  const index = (labs: unknown[]) => JSON.stringify({ formatVersion: 1, labs })

  it('index valide', () => {
    const r = parseLibraryIndex(index([entry()]))
    expect(r.ok && r.index.labs[0]?.title).toBe('Adressage IP et routage')
  })

  it('refus : JSON illisible, champ inconnu, chemin hors de labs/, empreinte mal formée, doublon, taille', () => {
    expect(parseLibraryIndex('{')).toEqual({
      ok: false,
      message: 'Index de la bibliothèque invalide : JSON illisible.'
    })
    expect(parseLibraryIndex(index([{ ...entry(), script: 'x' }])).ok).toBe(false)
    for (const file of [
      '../secret.json',
      'labs/../../x.json',
      'https://exemple.fr/lab.json',
      'labs/Lab.JSON'
    ])
      expect(parseLibraryIndex(index([entry({ file })])).ok, file).toBe(false)
    expect(parseLibraryIndex(index([entry({ sha256: 'abc' })])).ok).toBe(false)
    expect(parseLibraryIndex(index([entry(), entry()]))).toEqual({
      ok: false,
      message: 'Index de la bibliothèque invalide : lab « lab-01-adressage » en double.'
    })
    expect(parseLibraryIndex(' '.repeat(300 * 1024)).ok).toBe(false)
    expect(parseLibraryIndex(JSON.stringify({ formatVersion: 2, labs: [] })).ok).toBe(false)
  })
})

describe('Lab téléchargé', () => {
  it('empreinte et identifiant conformes : lab accepté', () => {
    const r = verifyLibraryLab(LAB_TEXT, entry())
    expect(r.ok && r.lab.id).toBe('lab-01-adressage')
  })

  it('fichier modifié : refusé par l’empreinte, avant toute analyse', () => {
    const r = verifyLibraryLab(LAB_TEXT.replace('Débutant', 'Avancé'), entry())
    expect(r).toEqual({
      ok: false,
      message:
        'Le lab « Adressage IP et routage » a été refusé : son empreinte SHA-256 ne correspond pas à l’index (fichier modifié ou incomplet).'
    })
  })

  it('identifiant différent de l’index, ou lab invalide : refusé', () => {
    const other = `${JSON.stringify({ ...lab1, id: 'autre' })}`
    const hash = createHash('sha256').update(other, 'utf8').digest('hex')
    expect(verifyLibraryLab(other, entry({ sha256: hash })).ok).toBe(false)
    const broken = '{"formatVersion":1}'
    const brokenHash = createHash('sha256').update(broken, 'utf8').digest('hex')
    const r = verifyLibraryLab(broken, entry({ sha256: brokenHash }))
    expect(!r.ok && r.message).toMatch(/^Lab invalide/)
  })
})
