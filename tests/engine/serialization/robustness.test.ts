/**
 * Robustesse des imports : un fichier .slab ou un lab corrompu, tronqué, trop gros ou enrichi de
 * champs inconnus ne fait jamais planter l'application (message en français, aucune exception).
 */
import { describe, expect, it } from 'vitest'
import {
  buildLabStart,
  MAX_LAB_LENGTH,
  MAX_SLAB_LENGTH,
  parseLab,
  parseLabText,
  parseSlab,
  serializeSlab,
  type ParseResult
} from '@engine/index'
import lab1 from '../../../labs/lab-01-adressage.json'
import lab4 from '../../../labs/lab-04-ad-gpo.json'

/** Générateur pseudo-aléatoire à graine fixe (mulberry32) : mêmes cas à chaque exécution. */
function random(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const parsedLab = parseLab(lab4)
if (!parsedLab.ok) throw new Error(parsedLab.message)
/** Document réaliste : domaine, GPO, DHCP, partages (lab 4 construit par le moteur). */
const BASE = serializeSlab(buildLabStart(parsedLab.lab.start), {
  savedAt: '2026-10-05T12:00:00.000Z',
  appVersion: 'test'
})

/** Appelle parseSlab en échouant si une exception s'échappe ; vérifie le message d'erreur. */
function safeParse(content: string): ParseResult {
  let result: ParseResult | undefined
  expect(() => (result = parseSlab(content))).not.toThrow()
  if (!result!.ok) {
    expect(result!.message.length).toBeGreaterThan(10)
    // Les cas courants sont repérés par la validation, pas par le filet de sécurité
    expect(result!.message).not.toContain('structure inattendue).')
  }
  return result!
}

describe('import .slab corrompu', () => {
  it('le document de base est valide', () => {
    expect(parseSlab(BASE).ok).toBe(true)
  })

  it('tronqué n’importe où : refusé avec un message clair', () => {
    for (let i = 1; i < 60; i++) {
      const cut = Math.floor((BASE.length * i) / 60)
      expect(safeParse(BASE.slice(0, cut)).ok).toBe(false)
    }
  })

  it('caractères altérés : jamais d’exception', () => {
    const next = random(2026)
    const noise = '{}[]":,0-1aéz\n\\ '
    for (let n = 0; n < 300; n++) {
      const chars = BASE.split('')
      for (let k = 0; k < 1 + Math.floor(next() * 4); k++)
        chars[Math.floor(next() * chars.length)] = noise[Math.floor(next() * noise.length)]!
      safeParse(chars.join(''))
    }
  })

  it('valeurs de mauvais type à chaque niveau : refusées sans exception', () => {
    const doc = JSON.parse(BASE) as Record<string, unknown>
    const lab = doc['lab'] as Record<string, unknown>
    const device = Object.values(lab['devices'] as Record<string, Record<string, unknown>>)[0]!
    const cases: [Record<string, unknown>, string][] = [
      [doc, 'schemaVersion'],
      [doc, 'lab'],
      [lab, 'devices'],
      [lab, 'links'],
      [lab, 'domains'],
      [lab, 'seq'],
      [device, 'interfaces'],
      [device, 'kind'],
      [device, 'host']
    ]
    for (const [target, key] of cases)
      for (const value of [null, 42, 'texte', [], {}, true]) {
        const saved = target[key]
        target[key] = value
        safeParse(JSON.stringify(doc))
        target[key] = saved
      }
  })

  it('champ de mauvais type : message entièrement en français', () => {
    const english = /Invalid|expected|received|discriminator/
    const doc = JSON.parse(BASE) as Record<string, unknown>
    const lab = doc['lab'] as Record<string, unknown>
    const device = Object.values(lab['devices'] as Record<string, Record<string, unknown>>)[0]!
    for (const [target, key, value] of [
      [lab, 'clock', 'abc'],
      [device, 'kind', 'grille-pain'],
      [lab, 'domains', []]
    ] as [Record<string, unknown>, string, unknown][]) {
      const saved = target[key]
      target[key] = value
      const r = safeParse(JSON.stringify(doc))
      target[key] = saved
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.message).toMatch(/^Fichier \.slab invalide \(champ /)
        expect(r.message).not.toMatch(english)
      }
    }
    // Lab pédagogique : même règle
    const badLab = parseLab({ ...lab1, title: 42 })
    expect(badLab.ok).toBe(false)
    if (!badLab.ok) expect(badLab.message).not.toMatch(english)
  })

  it('contenus qui ne sont pas un document : refusés', () => {
    for (const content of ['', 'null', '42', '"ServerLab"', '[]', 'true', '{}', '[{"app":"ServerLab"}]'])
      expect(safeParse(content).ok).toBe(false)
    expect(safeParse('['.repeat(100_000)).ok).toBe(false)
  })

  it('trop volumineux : refusé avant toute analyse', () => {
    const r = parseSlab(' '.repeat(MAX_SLAB_LENGTH + 1))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('trop volumineux')
  })

  it('champs inconnus : ignorés et retirés du document', () => {
    const doc = JSON.parse(BASE) as Record<string, unknown>
    doc['champInconnu'] = { script: 'alert(1)' }
    const lab = doc['lab'] as Record<string, unknown>
    lab['extension'] = true
    const device = Object.values(lab['devices'] as Record<string, Record<string, unknown>>)[0]!
    device['onclick'] = 'alert(1)'
    const r = safeParse(JSON.stringify(doc))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect('champInconnu' in r.doc).toBe(false)
      expect('extension' in r.doc.lab).toBe(false)
      expect(Object.values(r.doc.lab.devices).some((d) => 'onclick' in d)).toBe(false)
    }
  })
})

describe('import d’un lab corrompu', () => {
  const text = JSON.stringify(lab1)

  it('tronqué ou altéré : refusé sans exception', () => {
    const next = random(7)
    for (let i = 1; i < 40; i++) {
      const r = parseLabText(text.slice(0, Math.floor((text.length * i) / 40)))
      expect(r.ok).toBe(false)
    }
    for (let n = 0; n < 200; n++) {
      const chars = text.split('')
      chars[Math.floor(next() * chars.length)] = '{}[]":,x0'[Math.floor(next() * 9)]!
      expect(() => parseLabText(chars.join(''))).not.toThrow()
    }
  })

  it('trop volumineux, JSON illisible ou type de critère inconnu : message explicite', () => {
    expect(parseLabText(' '.repeat(MAX_LAB_LENGTH + 1))).toMatchObject({ ok: false })
    const unreadable = parseLabText('{ pas du json')
    expect(!unreadable.ok && unreadable.message).toContain('JSON illisible')
    const unknownCheck = parseLab({
      ...lab1,
      criteria: [
        { id: 'x', label: 'Test', hint: 'Indice suffisamment long', check: { type: 'exec', cmd: 'rm' } }
      ]
    })
    expect(!unknownCheck.ok && unknownCheck.message).toContain('criteria')
  })

  it('champs inconnus : ignorés et retirés du lab', () => {
    const r = parseLabText(JSON.stringify({ ...lab1, script: 'alert(1)', start: { ...lab1.start, hook: 1 } }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect('script' in r.lab).toBe(false)
      expect('hook' in r.lab.start).toBe(false)
    }
  })
})
