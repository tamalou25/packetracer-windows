/**
 * Moteur de scénarios (v2.6.1) : format déclaratif d'un scénario d'attaque ou d'incident, exécuté
 * étape par étape.
 *
 * Garde-fou : un scénario ne modélise que des transitions d'état abstraites (« cette étape réussit
 * ou échoue selon une condition sur l'état simulé et journalise tel événement »). Aucun exploit,
 * aucun algorithme de craquage, aucune charge utile : voir `docs/fidelite.md` (« Cybersécurité »).
 */
import { produce } from 'immer'
import { logEvent, type NewEvent } from '../core/eventlog'
import { fail, type EngineResult } from '../core/result'
import type { LabState } from '../model/schema'

/** État simulé lu et modifié par les étapes (comptes, machines, tickets, ACL…). */
export type SimState = LabState

/** Événement de sécurité à journaliser : toujours inscrit dans le journal Sécurité de `deviceId`. */
export type SecurityEvent = Omit<NewEvent, 'log'> & { deviceId: string }

/** Étape d'un scénario : lecture et écriture de l'état simulé, rien d'autre. */
export interface ScenarioStep {
  id: string
  /** Libellé affiché dans la chronologie, ex. « Tentative d'authentification ». */
  label: string
  /** Condition sur l'état simulé : vraie si l'étape aboutit. */
  precondition: (state: SimState) => boolean
  /** Effet si la précondition est vraie. */
  onSuccess: (state: SimState) => SimState
  /** Effet sinon. */
  onFailure: (state: SimState) => SimState
  /** Événements à journaliser selon le résultat. */
  emits: (success: boolean) => SecurityEvent[]
}

export type ScenarioCategory = 'annuaire' | 'reseau'

export interface AttackScenario {
  id: string
  name: string
  category: ScenarioCategory
  steps: ScenarioStep[]
}

/** Résultat d'une étape jouée : une ligne de la chronologie. */
export interface StepRecord {
  stepId: string
  label: string
  success: boolean
  /** Nombre d'événements inscrits dans les journaux. */
  eventCount: number
}

/** Joue l'étape d'indice `index` (une étape = un tour) et renvoie son résultat. */
export function playStep(state: SimState, scenario: AttackScenario, index: number): EngineResult<StepRecord> {
  const step = scenario.steps[index]
  if (!step) return fail('ScenarioFinished', 'Toutes les étapes du scénario ont déjà été jouées.')
  const success = step.precondition(state)
  const events = step.emits(success)
  // produce garantit que l'état précédent n'est jamais modifié, même par une étape maladroite
  const next = produce(success ? step.onSuccess(state) : step.onFailure(state), (draft) => {
    for (const { deviceId, ...event } of events) logEvent(draft, deviceId, { ...event, log: 'Sécurité' })
  })
  return {
    ok: true,
    state: next,
    value: { stepId: step.id, label: step.label, success, eventCount: events.length }
  }
}

/** Joue toutes les étapes restantes à partir de `from` (tests, labs). S'arrête à la première erreur. */
export function playAll(state: SimState, scenario: AttackScenario, from = 0): EngineResult<StepRecord[]> {
  const timeline: StepRecord[] = []
  let current = state
  for (let i = from; i < scenario.steps.length; i++) {
    const r = playStep(current, scenario, i)
    if (!r.ok) return r
    current = r.state
    timeline.push(r.value)
  }
  return { ok: true, state: current, value: timeline }
}
