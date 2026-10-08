/**
 * Scénarios « annuaire » : un lab vulnérable les laisse réussir, un lab durci (mot de passe fort,
 * verrouillage de compte, SPN récent) les fait tous échouer.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DOMAIN_POLICY_ID,
  command,
  dispatch,
  getScenario,
  listScenarios,
  playAll,
  playStep,
  type HostDevice,
  type LabState
} from '@engine/index'
import { buildReferenceLab } from '../serialization/reference-lab'

const DOMAIN = 'lab.local'
const DAY = 86_400_000
const id = (s: LabState, name: string) => Object.values(s.devices).find((d) => d.name === name)?.id ?? ''
const user = (s: LabState, sam: string) => s.domains[DOMAIN]!.users.find((u) => u.sam === sam)!
const host = (s: LabState, name: string) => s.devices[id(s, name)] as HostDevice
const securityIds = (s: LabState, name: string) =>
  host(s, name)
    .host.eventLog.filter((e) => e.log === 'Sécurité')
    .map((e) => e.eventId)

function apply(s: LabState, cmd: Parameters<typeof dispatch>[1]): LabState {
  const r = dispatch(s, cmd)
  if (!r.ok) throw new Error(r.error.message)
  return r.state
}

/** Joue un scénario enregistré (une étape) par la commande nommée, comme l'interface. */
function play(s: LabState, scenarioId: string): { state: LabState; success: boolean } {
  const r = dispatch(s, command('cyber.playStep', scenarioId, 0))
  if (!r.ok) throw new Error(r.error.message)
  return { state: r.state, success: (r.value as { success: boolean }).success }
}

/** Modification directe de l'état, réservée à la mise en place des tests (données du lab). */
function setup(s: LabState, edit: (lab: LabState) => void): LabState {
  const lab = structuredClone(s)
  edit(lab)
  return lab
}

/**
 * Lab de départ commun : PC1 en session sous jdupont, avec accès administrateur vers SRV1 ;
 * compte de service svc-sql (SPN) créé à l'horloge 0, lab observé 200 jours plus tard.
 */
function base(): LabState {
  return setup(buildReferenceLab(), (lab) => {
    lab.clock = 200 * DAY
    lab.cyber = { ...lab.cyber, targetAccount: 'jdupont' }
    const domain = lab.domains[DOMAIN]!
    domain.users.push({
      ...structuredClone(user(lab, 'jdupont')),
      id: 'svc1',
      sam: 'svc-sql',
      name: 'svc-sql'
    })
    const pc = lab.devices[id(lab, 'PC1')] as HostDevice
    pc.host.session = { user: 'jdupont', domain: 'LAB' }
    pc.host.adminTargets = [id(lab, 'SRV1')]
  })
}

/** Lab vulnérable : mot de passe hors stratégie, aucun verrouillage, SPN au mot de passe ancien. */
function vulnerable(): LabState {
  return setup(base(), (lab) => {
    user(lab, 'jdupont').password = 'jdupont'
    const svc = user(lab, 'svc-sql')
    svc.spns = ['MSSQLSvc/srv1.lab.local:1433']
    svc.passwordLastSet = 0
  })
}

/** Lab durci : mot de passe fort, verrouillage à 3 échecs, mot de passe du compte de service récent. */
function hardened(): LabState {
  let lab = setup(base(), (l) => {
    user(l, 'jdupont').password = 'Xk9#mQ2vLp!7'
    const svc = user(l, 'svc-sql')
    svc.spns = ['MSSQLSvc/srv1.lab.local:1433']
    svc.passwordLastSet = 190 * DAY
  })
  lab = apply(
    lab,
    command('gpo.updateSettings', DOMAIN, DEFAULT_DOMAIN_POLICY_ID, {
      computer: { lockoutThreshold: 3, lockoutDuration: 30, lockoutReset: 30 }
    })
  )
  return lab
}

describe('registre des scénarios annuaire', () => {
  it('fournit les trois scénarios de la catégorie annuaire', () => {
    const annuaire = listScenarios().filter((s) => s.category === 'annuaire')
    expect(annuaire.map((s) => s.id)).toEqual(['auth-repetee', 'compte-service', 'reutilisation-acces'])
  })
})

describe('1. authentification répétée', () => {
  it('mot de passe faible sans verrouillage : compte compromis, échecs puis succès journalisés', () => {
    const { state, success } = play(vulnerable(), 'auth-repetee')
    expect(success).toBe(true)
    expect(user(state, 'jdupont').compromised).toBe(true)
    // attempts - 1 = 4 échecs 4771 puis un 4768 sur le contrôleur
    expect(securityIds(state, 'SRV1').slice(-5)).toEqual([4771, 4771, 4771, 4771, 4768])
  })

  it('verrouillage actif : le compte se verrouille après N échecs lus dans l’état, tentative échouée', () => {
    // Même mot de passe faible : seul le verrouillage change
    const lab = apply(
      vulnerable(),
      command('gpo.updateSettings', DOMAIN, DEFAULT_DOMAIN_POLICY_ID, {
        computer: { lockoutThreshold: 4, lockoutDuration: 30, lockoutReset: 30 }
      })
    )
    const { state, success } = play(lab, 'auth-repetee')
    expect(success).toBe(false)
    expect(user(state, 'jdupont').compromised).toBe(false)
    expect(user(state, 'jdupont').lockoutTime).not.toBeNull()
    expect(user(state, 'jdupont').badPwdCount).toBe(4)
    expect(securityIds(state, 'SRV1').slice(-5)).toEqual([4771, 4771, 4771, 4771, 4740])
  })

  it('le seuil n’est pas codé en dur : il suit la stratégie', () => {
    const lab = apply(
      vulnerable(),
      command('gpo.updateSettings', DOMAIN, DEFAULT_DOMAIN_POLICY_ID, {
        computer: { lockoutThreshold: 2, lockoutDuration: 30, lockoutReset: 30 }
      })
    )
    expect(securityIds(play(lab, 'auth-repetee').state, 'SRV1').filter((e) => e === 4771)).toHaveLength(2)
  })

  it('mot de passe fort et pas de verrouillage : échec, aucun compte affecté', () => {
    const lab = setup(vulnerable(), (l) => (user(l, 'jdupont').password = 'Xk9#mQ2vLp!7'))
    const { state, success } = play(lab, 'auth-repetee')
    expect(success).toBe(false)
    expect(user(state, 'jdupont').compromised).toBe(false)
    expect(user(state, 'jdupont').lockoutTime).toBeNull()
  })

  it('sans compte visé dans le lab : échec sans effet ni événement', () => {
    const lab = setup(vulnerable(), (l) => (l.cyber.targetAccount = null))
    const { state, success } = play(lab, 'auth-repetee')
    expect(success).toBe(false)
    expect(securityIds(state, 'SRV1')).toEqual(securityIds(lab, 'SRV1'))
  })
})

describe('2. compte de service mal configuré', () => {
  it('SPN et mot de passe ancien : compte compromis', () => {
    const { state, success } = play(vulnerable(), 'compte-service')
    expect(success).toBe(true)
    expect(user(state, 'svc-sql').compromised).toBe(true)
    expect(securityIds(state, 'SRV1').at(-1)).toBe(4769)
  })

  it('la durée vient du lab : avec 365 jours, le même mot de passe n’est plus négligé', () => {
    const lab = setup(vulnerable(), (l) => (l.cyber.serviceMaxAgeDays = 365))
    const { state, success } = play(lab, 'compte-service')
    expect(success).toBe(false)
    expect(user(state, 'svc-sql').compromised).toBe(false)
  })

  it('mot de passe récent : aucun compte affecté', () => {
    const { state, success } = play(hardened(), 'compte-service')
    expect(success).toBe(false)
    expect(state.domains[DOMAIN]!.users.some((u) => u.compromised)).toBe(false)
  })

  it('sans SPN, même avec un mot de passe ancien : rien ne se passe', () => {
    const lab = setup(vulnerable(), (l) => (user(l, 'svc-sql').spns = []))
    const { state, success } = play(lab, 'compte-service')
    expect(success).toBe(false)
    expect(state.domains[DOMAIN]!.users.some((u) => u.compromised)).toBe(false)
  })
})

describe('3. réutilisation d’un accès déjà obtenu', () => {
  const compromised = (lab: LabState) => setup(lab, (l) => (user(l, 'jdupont').compromised = true))

  it('compte compromis en session sur une machine qui administre une autre : accès propagé', () => {
    const { state, success } = play(compromised(vulnerable()), 'reutilisation-acces')
    expect(success).toBe(true)
    expect(host(state, 'SRV1').host.controlled).toBe(true)
    expect(host(state, 'PC1').host.controlled).toBe(false)
    expect(securityIds(state, 'SRV1').slice(-2)).toEqual([4624, 4672])
  })

  it('compte non compromis : rien ne se passe', () => {
    const { state, success } = play(vulnerable(), 'reutilisation-acces')
    expect(success).toBe(false)
    expect(host(state, 'SRV1').host.controlled).toBe(false)
  })

  it('compromis mais sans session ouverte : rien ne se passe', () => {
    const lab = setup(
      compromised(vulnerable()),
      (l) => ((l.devices[id(l, 'PC1')] as HostDevice).host.session = null)
    )
    expect(play(lab, 'reutilisation-acces').success).toBe(false)
  })

  it('compromis en session mais sans accès administrateur vers une autre machine : rien ne se passe', () => {
    const lab = setup(
      compromised(vulnerable()),
      (l) => ((l.devices[id(l, 'PC1')] as HostDevice).host.adminTargets = [])
    )
    const { state, success } = play(lab, 'reutilisation-acces')
    expect(success).toBe(false)
    expect(host(state, 'SRV1').host.controlled).toBe(false)
  })
})

describe('critère d’acceptation : lab vulnérable contre lab durci', () => {
  const run = (lab: LabState) => {
    let s = lab
    return ['auth-repetee', 'compte-service', 'reutilisation-acces'].map((sid) => {
      const r = playAll(s, getScenario(sid)!)
      if (!r.ok) throw new Error(r.error.message)
      s = r.state
      return r.value.every((step) => step.success)
    })
  }

  it('le lab vulnérable laisse réussir les trois scénarios, joués à la suite', () => {
    expect(run(vulnerable())).toEqual([true, true, true])
  })

  it('le lab durci fait échouer les trois scénarios', () => {
    expect(run(hardened())).toEqual([false, false, false])
  })

  it('un scénario ne modifie jamais l’état d’origine', () => {
    const lab = vulnerable()
    const before = JSON.stringify(lab)
    playStep(lab, getScenario('auth-repetee')!, 0)
    expect(JSON.stringify(lab)).toBe(before)
  })
})
