/// <reference types="vite/client" />
/**
 * Écrit le fichier de référence de la version courante du format : `npm run fixture:slab`.
 * Ignoré par `npm test` (s'exécute seulement en mode « fixture ») ; ne remplace jamais un fichier
 * existant, car un fichier de référence représente pour toujours les .slab de sa version.
 */
import { existsSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CURRENT_SCHEMA_VERSION, serializeSlab } from '@engine/index'
import pkg from '../../../package.json'
import { fixtureUrl } from './fixtures'
import { buildReferenceLab, REFERENCE_SAVED_AT } from './reference-lab'

describe.runIf(import.meta.env.MODE === 'fixture')('fichier de référence de la version courante', () => {
  it(`écrit fixtures/v${CURRENT_SCHEMA_VERSION}.slab`, () => {
    const target = fixtureUrl(CURRENT_SCHEMA_VERSION)
    expect(existsSync(target), `fixtures/v${CURRENT_SCHEMA_VERSION}.slab existe déjà`).toBe(false)
    const text = serializeSlab(buildReferenceLab(), {
      savedAt: REFERENCE_SAVED_AT,
      appVersion: pkg.version,
      viewport: { x: 0, y: 0, zoom: 1 }
    })
    writeFileSync(target, `${text}\n`)
  })
})
