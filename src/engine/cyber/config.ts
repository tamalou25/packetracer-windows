/**
 * Configuration des labs de cybersécurité : paramètres `cyber` du lab et accès administrateur d'un
 * ordinateur vers d'autres. Données de départ des labs ; aucune attaque ici (voir `scenarios/`).
 */
import { fail, transact, type EngineResult } from '../core/result'
import { CyberConfigSchema, type CyberConfig, type LabState } from '../model/schema'
import { getScenario } from './registry'

/** Modification partielle de `cyber` (les champs absents sont conservés). */
export type CyberConfigPatch = Partial<CyberConfig>

/** Applique une modification de la configuration `cyber` après validation par le schéma. */
export function configureCyber(state: LabState, patch: CyberConfigPatch): EngineResult {
  const parsed = CyberConfigSchema.safeParse({ ...state.cyber, ...patch })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return fail(
      'InvalidCyberConfig',
      `Paramètres de cybersécurité invalides${issue ? ` (champ ${issue.path.join('.')})` : ''}.`
    )
  }
  const unknown = (parsed.data.scenarios ?? []).filter((id) => !getScenario(id))
  if (unknown.length > 0) return fail('ScenarioNotFound', `Scénario introuvable : ${unknown.join(', ')}.`)
  return transact(state, (draft) => {
    draft.cyber = parsed.data
    return undefined
  })
}

/** Définit les machines vers lesquelles les sessions d'un ordinateur ont un accès administrateur. */
export function setAdminAccess(state: LabState, deviceId: string, targetIds: string[]): EngineResult {
  const host = state.devices[deviceId]
  if (!host || (host.kind !== 'server' && host.kind !== 'client'))
    return fail('DeviceNotFound', 'Seul un serveur ou un poste peut porter un accès administrateur.')
  for (const id of targetIds) {
    const target = state.devices[id]
    if (!target || (target.kind !== 'server' && target.kind !== 'client') || id === deviceId)
      return fail('DeviceNotFound', 'La cible d’un accès administrateur est un autre serveur ou poste.')
  }
  return transact(state, (draft) => {
    const d = draft.devices[deviceId]
    if (d && (d.kind === 'server' || d.kind === 'client')) d.host.adminTargets = [...new Set(targetIds)]
    return undefined
  })
}
