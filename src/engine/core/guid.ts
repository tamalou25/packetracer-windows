/**
 * Identifiants globaux (GUID) déterministes : dérivés d'une graine (identifiant interne),
 * jamais tirés au hasard, pour que le moteur reste reproductible.
 */

/** GUID au format 8-4-4-4-12 (minuscules), dérivé de la graine par hachage FNV-1a. */
export function guidFromSeed(seed: string): string {
  let h = 2166136261
  const hex: string[] = []
  for (let round = 0; round < 4; round++) {
    for (const c of `${seed}#${round}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0
    hex.push(h.toString(16).padStart(8, '0'))
  }
  const s = hex.join('')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`
}

/** GUID entre accolades et en majuscules, comme l'identifiant d'une GPO. */
export function bracedGuid(guid: string): string {
  return `{${guid.toUpperCase()}}`
}
