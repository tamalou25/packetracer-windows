import { describe, expect, it } from 'vitest'
import { CURRENT_SCHEMA_VERSION, createLab, parseSlab, serializeSlab } from '@engine/index'
import { add, cable } from '../helpers'

const opts = { savedAt: '2026-01-01T00:00:00.000Z', appVersion: '0.1.0' }

describe('format .slab', () => {
  it('fait un aller-retour sans perte', () => {
    const a = add(createLab(), 'server')
    const b = add(a.state, 'switch')
    const lab = cable(b.state, a.id, 0, b.id, 3)
    const text = serializeSlab(lab, { ...opts, viewport: { x: 10, y: 20, zoom: 1.5 } })
    const parsed = parseSlab(text)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.doc.lab).toEqual(lab)
      expect(parsed.doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
      expect(parsed.doc.ui.viewport).toEqual({ x: 10, y: 20, zoom: 1.5 })
    }
  })

  it('refuse un JSON illisible', () => {
    const r = parseSlab('{pas du json')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('JSON')
  })

  it('refuse un fichier d’une autre application', () => {
    expect(parseSlab(JSON.stringify({ app: 'Autre', schemaVersion: 1 })).ok).toBe(false)
  })

  it('refuse un format plus récent', () => {
    const r = parseSlab(JSON.stringify({ app: 'ServerLab', schemaVersion: CURRENT_SCHEMA_VERSION + 1 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('plus récente')
  })

  it('applique les valeurs par défaut des champs absents', () => {
    const doc = JSON.parse(serializeSlab(createLab(), opts)) as Record<string, unknown>
    delete doc['meta']
    delete doc['ui']
    const r = parseSlab(JSON.stringify(doc))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.doc.ui.viewport).toBeNull()
  })

  it('détecte un câble vers un port inexistant', () => {
    const a = add(createLab(), 'client')
    const b = add(a.state, 'switch')
    const lab = cable(b.state, a.id, 0, b.id, 0)
    const doc = JSON.parse(serializeSlab(lab, opts)) as {
      lab: { links: Record<string, { a: { ifaceId: string } }> }
    }
    const link = Object.values(doc.lab.links)[0]!
    link.a.ifaceId = 'inexistant'
    const r = parseSlab(JSON.stringify(doc))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('port inexistant')
  })
})
