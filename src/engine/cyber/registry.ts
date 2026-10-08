/**
 * Registre des scénarios. Les scénarios concrets sont ajoutés dans les issues suivantes, chacun
 * dans son fichier sous `scenarios/`, puis déclarés dans `scenarios/index.ts`.
 */
import type { LabState } from '../model/schema'
import type { AttackScenario } from './scenario'
import { SCENARIOS } from './scenarios'

const registry = new Map<string, AttackScenario>()

/** Enregistre un scénario (identifiant unique ; les étapes aussi). */
export function registerScenario(scenario: AttackScenario): void {
  if (registry.has(scenario.id)) throw new Error(`Scénario déjà enregistré : ${scenario.id}`)
  const ids = scenario.steps.map((s) => s.id)
  if (new Set(ids).size !== ids.length) throw new Error(`Étapes en double dans ${scenario.id}`)
  registry.set(scenario.id, scenario)
}

/** Retire un scénario (utile aux tests qui enregistrent un scénario factice). */
export function unregisterScenario(id: string): void {
  registry.delete(id)
}

/** Scénarios activés dans un lab (`cyber.scenarios` ; null : tous), dans l'ordre du registre. */
export function scenariosOf(state: LabState): AttackScenario[] {
  const enabled = state.cyber.scenarios
  return listScenarios().filter((s) => enabled === null || enabled.includes(s.id))
}

export const getScenario = (id: string): AttackScenario | undefined => registry.get(id)
export const listScenarios = (): AttackScenario[] => [...registry.values()]

SCENARIOS.forEach(registerScenario)
