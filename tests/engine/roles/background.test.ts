/**
 * Tâches de fond incrémentales : une tâche n'est relancée que si ses dépendances ont changé
 * (pas de DORA retenté à chaque déplacement), et repasse dès qu'un changement la concerne.
 */
import { describe, expect, it } from 'vitest'
import {
  connect,
  moveDevice,
  renameDevice,
  runBackgroundTasks,
  setPower,
  unwrap,
  type LabState
} from '@engine/index'
import { buildLargeLab } from '../../support/large-lab'

const lease = (s: LabState, id: string) => s.devices[id]?.interfaces[0]?.dhcpLease?.address

describe('tâches de fond incrémentales', () => {
  it('sans mémo, toutes les tâches passent', () => {
    const { state } = buildLargeLab()
    expect(runBackgroundTasks(state).ran).toEqual(['dhcp.client', 'gpo.refresh'])
  })

  it('déplacer ou renommer : aucune tâche relancée, état inchangé', () => {
    const { state, ids } = buildLargeLab()
    let { state: s, memo } = runBackgroundTasks(state)
    for (let i = 1; i <= 30; i++) {
      s = unwrap(moveDevice(s, ids['PC85']!, { x: i * 10, y: 0 })).state
      const run = runBackgroundTasks(s, memo)
      expect(run.ran).toEqual([])
      expect(run.state).toBe(s)
      memo = run.memo
    }
    const renamed = unwrap(renameDevice(s, ids['SW8']!, 'SW-ISOLE')).state
    expect(runBackgroundTasks(renamed, memo).ran).toEqual([])
  })

  it('son propre résultat ne la relance pas', () => {
    const { state } = buildLargeLab()
    const first = runBackgroundTasks(state)
    expect(runBackgroundTasks(first.state, first.memo).ran).toEqual([])
  })

  it('un changement du réseau la relance : le switch isolé est raccordé, ses postes obtiennent un bail', () => {
    const { state, ids } = buildLargeLab()
    const { state: s, memo } = runBackgroundTasks(state)
    expect(lease(s, ids['PC85']!)).toBeUndefined()
    const port = (name: string, i: number) => ({
      deviceId: ids[name]!,
      ifaceId: s.devices[ids[name]!]?.interfaces[i]?.id ?? ''
    })
    const cabled = unwrap(connect(s, port('SW8', 15), port('SW1', 15))).state
    const run = runBackgroundTasks(cabled, memo)
    expect(run.ran).toContain('dhcp.client')
    expect(lease(run.state, ids['PC85']!)).toMatch(/^10\.0\./)
  })

  it('serveur DHCP éteint puis rallumé : la tâche repasse à chaque changement d’alimentation', () => {
    const { state, ids } = buildLargeLab()
    let { state: s, memo } = runBackgroundTasks(state)
    s = unwrap(setPower(s, ids['SRV1']!, false)).state
    let run = runBackgroundTasks(s, memo)
    expect(run.ran).toContain('dhcp.client')
    s = unwrap(setPower(run.state, ids['SRV1']!, true)).state
    memo = run.memo
    run = runBackgroundTasks(s, memo)
    expect(run.ran).toContain('dhcp.client')
  })

  it('100 déplacements avec tâches de fond : rapide (seuil fixé après mesure)', () => {
    const { state, ids } = buildLargeLab()
    let { state: s, memo } = runBackgroundTasks(state)
    const start = performance.now()
    for (let i = 1; i <= 100; i++) {
      s = unwrap(moveDevice(s, ids['PC1']!, { x: i, y: i })).state
      const run = runBackgroundTasks(s, memo)
      s = run.state
      memo = run.memo
    }
    // ~0,2 ms par passage mesurés avant optimisation ; marge large pour la CI
    expect((performance.now() - start) / 100).toBeLessThan(2)
  })
})
