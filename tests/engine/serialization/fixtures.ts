/** Emplacement des fichiers .slab de référence (un par version du format). */
import { readFileSync } from 'node:fs'

export function fixtureUrl(version: number): URL {
  return new URL(`./fixtures/v${version}.slab`, import.meta.url)
}

export function readFixture(version: number): string {
  return readFileSync(fixtureUrl(version), 'utf8')
}
