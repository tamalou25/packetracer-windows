/**
 * Patches immer calculés par diff structurel : appliquer les patches redonne l'état d'après,
 * appliquer les inverses redonne l'état d'avant, sur de vraies actions du moteur.
 */
import { describe, expect, it } from 'vitest'
import {
  applyStatePatches,
  buildLabStart,
  diffStates,
  disconnect,
  moveDevice,
  parseLab,
  removeDevices,
  renameDevice,
  setPower,
  unwrap,
  type LabState
} from '@engine/index'
import lab4 from '../../../labs/lab-04-ad-gpo.json'
import { run } from '../shell/helpers'

const parsed = parseLab(lab4)
if (!parsed.ok) throw new Error(parsed.message)
const START = buildLabStart(parsed.lab.start)
const id = (s: LabState, name: string) => Object.values(s.devices).find((d) => d.name === name)?.id ?? ''

/** Vérifie l'aller-retour et renvoie le nombre de patches. */
function roundTrip(before: LabState, after: LabState): number {
  const { patches, inversePatches } = diffStates(before, after)
  expect(applyStatePatches(before, patches)).toEqual(after)
  expect(applyStatePatches(after, inversePatches)).toEqual(before)
  return patches.length
}

describe('diffStates', () => {
  it('aucun patch entre deux états identiques', () => {
    expect(diffStates(START, START)).toEqual({ patches: [], inversePatches: [] })
  })

  it('aller-retour sur une suite d’actions réelles (GUI et console)', () => {
    const steps: ((s: LabState) => LabState)[] = [
      (s) => unwrap(moveDevice(s, id(s, 'PC1'), { x: 123, y: 456 })).state,
      (s) => unwrap(renameDevice(s, id(s, 'PC1'), 'POSTE1')).state,
      (s) => run(s, id(s, 'SRV1'), 'New-ADOrganizationalUnit -Name Compta').state,
      (s) =>
        run(
          s,
          id(s, 'SRV1'),
          'New-ADUser -Name "Jean Dupont" -SamAccountName jdupont -Path "OU=Compta,DC=lab,DC=local" -AccountPassword (ConvertTo-SecureString "Azerty123!" -AsPlainText -Force) -Enabled $true'
        ).state,
      (s) => run(s, id(s, 'SRV1'), 'New-GPO -Name GPO-Compta').state,
      (s) => run(s, id(s, 'SRV1'), 'Remove-GPO -Name GPO-Compta', { answers: ['O'] }).state,
      (s) => unwrap(setPower(s, id(s, 'POSTE1'), false)).state,
      (s) => unwrap(disconnect(s, Object.keys(s.links)[0]!)).state,
      (s) => unwrap(removeDevices(s, [id(s, 'POSTE1')])).state
    ]
    let state = START
    for (const step of steps) {
      const next = step(state)
      expect(next).not.toBe(state)
      expect(roundTrip(state, next)).toBeGreaterThan(0)
      state = next
    }
    // Retour au point de départ en enchaînant tous les inverses
    expect(roundTrip(START, state)).toBeGreaterThan(0)
  })

  it('ne descend que dans les branches modifiées', () => {
    const next = unwrap(moveDevice(START, id(START, 'PC1'), { x: 1, y: 2 })).state
    const { patches } = diffStates(START, next)
    expect(patches.every((p) => p.path[0] === 'devices' && p.path[1] === id(START, 'PC1'))).toBe(true)
  })

  it('ajout et suppression de clés, tableaux de longueur différente', () => {
    const a = START
    const b = { ...a, devices: { ...a.devices }, seq: a.seq + 1 } as LabState
    delete (b.devices as Record<string, unknown>)[id(a, 'PC1')]
    ;(b.devices as Record<string, unknown>)['nouveau'] = a.devices[id(a, 'SRV1')]
    const domain = a.domains['lab.local']!
    const c = { ...b, domains: { 'lab.local': { ...domain, users: domain.users.slice(1) } } } as LabState
    roundTrip(a, c)
  })
})
