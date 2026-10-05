/**
 * Résultat standard des actions du moteur et outils de transaction (immer).
 */
import { produce, type Draft } from 'immer'
import type { LabState } from '../model/schema'

/** Erreur métier, avec un message en français destiné à l'utilisateur. */
export interface EngineError {
  /** Code stable, utilisable par les consoles pour formater l'erreur (ex. FullyQualifiedErrorId). */
  code: string
  message: string
}

export type EngineResult<T = undefined> =
  { ok: true; state: LabState; value: T } | { ok: false; error: EngineError }

/** Exception interne levée dans une transaction pour l'annuler proprement. */
export class EngineFailure extends Error {
  constructor(public readonly error: EngineError) {
    super(error.message)
    this.name = 'EngineFailure'
  }
}

/** Interrompt la transaction en cours avec une erreur métier. */
export function raise(code: string, message: string): never {
  throw new EngineFailure({ code, message })
}

export function fail(code: string, message: string): { ok: false; error: EngineError } {
  return { ok: false, error: { code, message } }
}

/**
 * Applique une modification à l'état de façon immuable.
 * Si la recette appelle `raise`, l'état d'origine est conservé et l'erreur renvoyée.
 */
export function transact<T>(state: LabState, recipe: (draft: Draft<LabState>) => T): EngineResult<T> {
  let value: T | undefined
  try {
    const next = produce(state, (draft) => {
      value = recipe(draft)
    })
    return { ok: true, state: next, value: value as T }
  } catch (e) {
    if (e instanceof EngineFailure) return { ok: false, error: e.error }
    throw e
  }
}

/** Renvoie l'état d'un résultat ou lève une exception (pratique pour les tests et les labs). */
export function unwrap<T>(result: EngineResult<T>): { state: LabState; value: T } {
  if (!result.ok) throw new Error(`[${result.error.code}] ${result.error.message}`)
  return { state: result.state, value: result.value }
}
