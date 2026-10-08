/**
 * Contre-mesures du mode Red/Blue : chacune applique un durcissement existant, devient inutile une
 * fois en place, et fait échouer le scénario qu'elle vise.
 */
import { describe, expect, it } from 'vitest'
import {
  COUNTERMEASURES,
  availableCountermeasures,
  command,
  dispatch,
  playStep,
  getScenario,
  type LabState
} from '@engine/index'
import { redBlueLab } from '../../cyber-lab'

function harden(s: LabState, id: string): LabState {
  const r = dispatch(s, command('cyber.applyCountermeasure', id))
  if (!r.ok) throw new Error(r.error.message)
  return r.state
}

const succeeds = (s: LabState, scenario: string): boolean => {
  const r = playStep(s, getScenario(scenario)!, 0)
  if (!r.ok) throw new Error(r.error.message)
  return r.value.success
}

describe('contre-mesures', () => {
  it('le lab vulnérable offre les cinq contre-mesures', () => {
    expect(availableCountermeasures(redBlueLab()).map((c) => c.id)).toEqual(COUNTERMEASURES.map((c) => c.id))
  })

  it.each([
    ['lockout', 'auth-repetee'],
    ['strong-password', 'auth-repetee'],
    ['rotate-service', 'compte-service'],
    ['dai', 'usurpation-arp'],
    ['nonegotiate', 'saut-de-vlan']
  ])('%s fait échouer %s, puis n’est plus proposée', (id, scenario) => {
    const lab = redBlueLab()
    expect(succeeds(lab, scenario)).toBe(true)
    const hardened = harden(lab, id)
    expect(succeeds(hardened, scenario)).toBe(false)
    expect(availableCountermeasures(hardened).map((c) => c.id)).not.toContain(id)
  })

  it('refuse une contre-mesure déjà en place et une contre-mesure inconnue', () => {
    const once = harden(redBlueLab(), 'dai')
    const again = dispatch(once, command('cyber.applyCountermeasure', 'dai'))
    expect(again.ok).toBe(false)
    const unknown = dispatch(redBlueLab(), command('cyber.applyCountermeasure', 'inconnue'))
    expect(!unknown.ok && unknown.error.code).toBe('CountermeasureNotFound')
  })

  it('sur un lab sans cible, aucune contre-mesure n’est utile', () => {
    const lab = {
      ...redBlueLab(),
      cyber: { ...redBlueLab().cyber, targetAccount: null, arpSpoof: null, vlanHop: null }
    }
    const noService = structuredClone(lab)
    for (const u of noService.domains['lab.local']!.users) u.spns = []
    expect(availableCountermeasures(noService)).toEqual([])
  })
})
