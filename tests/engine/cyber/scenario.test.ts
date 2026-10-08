/**
 * Moteur de scénarios : scénario factice à deux étapes (l'une réussit, l'autre échoue selon une
 * précondition), sans aucune attaque réelle.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  command,
  dispatch,
  getScenario,
  listScenarios,
  playAll,
  playStep,
  registerScenario,
  unregisterScenario,
  type AttackScenario,
  type LabState
} from '@engine/index'
import { buildReferenceLab } from '../serialization/reference-lab'

const server = (s: LabState) => Object.values(s.devices).find((d) => d.kind === 'server')!
const events = (s: LabState) =>
  server(s).kind === 'server'
    ? (server(s) as { host: { eventLog: { eventId: number; log: string }[] } }).host.eventLog
    : []

/** Scénario factice : étape 1 vraie d'office, étape 2 conditionnée par l'état (nom du premier serveur). */
function fake(deviceId: string): AttackScenario {
  return {
    id: 'test-factice',
    name: 'Scénario factice',
    category: 'annuaire',
    steps: [
      {
        id: 'a',
        label: 'Étape qui réussit',
        precondition: () => true,
        onSuccess: (s) => ({ ...s, seq: s.seq + 100 }),
        onFailure: (s) => s,
        emits: (ok) => [
          {
            deviceId,
            level: ok ? 'information' : 'warning',
            source: 'Test',
            eventId: ok ? 9001 : 9002,
            message: 'a'
          }
        ]
      },
      {
        id: 'b',
        label: 'Étape qui échoue',
        precondition: (s) => s.devices[deviceId]?.name === 'NOM-IMPOSSIBLE',
        onSuccess: (s) => s,
        onFailure: (s) => ({ ...s, seq: s.seq + 1000 }),
        emits: (ok) => [
          { deviceId, level: 'warning', source: 'Test', eventId: ok ? 9003 : 9004, message: 'b' }
        ]
      }
    ]
  }
}

describe('moteur de scénarios', () => {
  const lab = buildReferenceLab()
  const scenario = fake(server(lab).id)

  afterEach(() => unregisterScenario(scenario.id))

  it('le registre ne contient que les scénarios fournis (pas le scénario factice)', () => {
    expect(listScenarios().map((s) => s.id)).not.toContain(scenario.id)
  })

  it('une étape qui réussit applique onSuccess et journalise dans le journal Sécurité', () => {
    const r = playStep(lab, scenario, 0)
    if (!r.ok) throw new Error(r.error.message)
    expect(r.value).toEqual({ stepId: 'a', label: 'Étape qui réussit', success: true, eventCount: 1 })
    expect(r.state.seq).toBeGreaterThanOrEqual(lab.seq + 100)
    expect(events(r.state).at(-1)).toMatchObject({ eventId: 9001, log: 'Sécurité' })
  })

  it('une étape dont la précondition est fausse applique onFailure', () => {
    const r = playStep(lab, scenario, 1)
    if (!r.ok) throw new Error(r.error.message)
    expect(r.value.success).toBe(false)
    expect(r.state.seq).toBeGreaterThanOrEqual(lab.seq + 1000)
    expect(events(r.state).at(-1)?.eventId).toBe(9004)
  })

  it('ne modifie jamais l’état d’origine et reste déterministe', () => {
    const before = JSON.stringify(lab)
    const a = playAll(lab, scenario)
    const b = playAll(lab, scenario)
    expect(JSON.stringify(lab)).toBe(before)
    expect(a).toEqual(b)
  })

  it('playAll renvoie la chronologie complète', () => {
    const r = playAll(lab, scenario)
    if (!r.ok) throw new Error(r.error.message)
    expect(r.value.map((x) => x.success)).toEqual([true, false])
  })

  it('refuse une étape hors du scénario', () => {
    const r = playStep(lab, scenario, 2)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('ScenarioFinished')
  })

  it('la commande cyber.playStep passe par dispatch (libellé et patches)', () => {
    registerScenario(scenario)
    expect(getScenario(scenario.id)).toBe(scenario)
    const r = dispatch(lab, command('cyber.playStep', scenario.id, 1))
    if (!r.ok) throw new Error(r.error.message)
    expect(r.entry?.label).toBe('Scénario Scénario factice : Étape qui échoue')
    expect(events(r.state).at(-1)?.eventId).toBe(9004)
  })

  it('la commande refuse un scénario inconnu', () => {
    const r = dispatch(lab, command('cyber.playStep', 'inconnu', 0))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('ScenarioNotFound')
  })

  it('refuse deux scénarios de même identifiant', () => {
    registerScenario(scenario)
    expect(() => registerScenario(scenario)).toThrow()
  })
})
