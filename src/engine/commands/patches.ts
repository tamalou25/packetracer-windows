/**
 * Patches immer entre deux états du lab, pour l'annuler/rétablir et le journal des commandes.
 *
 * Les actions du moteur produisent un nouvel état par `transact` (immer) : tout ce qui n'a pas changé
 * est partagé par référence avec l'état précédent. Le diff ne descend donc que dans les branches
 * dont la référence a changé (coût proportionnel aux modifications) et produit des patches au
 * format immer, avec leurs inverses : aucune fonction inverse n'est écrite à la main.
 */
import { applyPatches, enablePatches, type Patch } from 'immer'
import type { LabState } from '../model/schema'

enablePatches()

export type { Patch }

export interface StateDiff {
  /** Passent de l'état d'avant à l'état d'après (rétablir). */
  patches: Patch[]
  /** Passent de l'état d'après à l'état d'avant (annuler). */
  inversePatches: Patch[]
}

type Path = (string | number)[]

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function diff(before: unknown, after: unknown, path: Path, out: StateDiff): void {
  if (before === after) return
  if (isPlainObject(before) && isPlainObject(after)) {
    for (const key of Object.keys(after)) {
      if (!(key in before)) {
        out.patches.push({ op: 'add', path: [...path, key], value: after[key] })
        out.inversePatches.push({ op: 'remove', path: [...path, key] })
      } else diff(before[key], after[key], [...path, key], out)
    }
    for (const key of Object.keys(before)) {
      if (key in after) continue
      out.patches.push({ op: 'remove', path: [...path, key] })
      out.inversePatches.push({ op: 'add', path: [...path, key], value: before[key] })
    }
    return
  }
  // Tableau de même longueur : élément par élément ; sinon remplacé en entier (les éléments
  // inchangés restent partagés par référence avec l'état d'origine)
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    for (let i = 0; i < after.length; i++) diff(before[i], after[i], [...path, i], out)
    return
  }
  out.patches.push({ op: 'replace', path, value: after })
  out.inversePatches.push({ op: 'replace', path, value: before })
}

/** Patches (et inverses) qui transforment `before` en `after`. */
export function diffStates(before: LabState, after: LabState): StateDiff {
  const out: StateDiff = { patches: [], inversePatches: [] }
  diff(before, after, [], out)
  // Les inverses s'appliquent dans l'ordre contraire
  out.inversePatches.reverse()
  return out
}

/** Applique des patches à un état (immuable : renvoie un nouvel état). */
export function applyStatePatches(state: LabState, patches: readonly Patch[]): LabState {
  return patches.length === 0 ? state : applyPatches(state, patches as Patch[])
}
