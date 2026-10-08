/**
 * Détection dans les journaux : compte inscrit sur les événements, ticket de service 4769,
 * affichages prédéfinis et corrélations « échecs puis succès » et « hors horaires ».
 */
import { describe, expect, it } from 'vitest'
import {
  DETECTION_VIEWS,
  command,
  detectAlerts,
  dispatch,
  CheckSchema,
  evaluateCheck,
  isOffHours,
  securityEvents,
  type LabState
} from '@engine/index'
import { buildReferenceLab } from '../serialization/reference-lab'

const id = (s: LabState, name: string) => Object.values(s.devices).find((d) => d.name === name)?.id ?? ''
const HOUR = 3_600_000

function logon(s: LabState, password: string, sam = 'jdupont'): LabState {
  const r = dispatch(s, command('adds.logon', id(s, 'PC1'), { user: sam, password, domain: 'LAB' }))
  if (!r.ok) throw new Error(r.error.message)
  return r.state
}
const logoff = (s: LabState): LabState => {
  const r = dispatch(s, command('adds.logoff', id(s, 'PC1')))
  if (!r.ok) throw new Error(r.error.message)
  return r.state
}
const view = (vid: string) => DETECTION_VIEWS.find((v) => v.id === vid)!.filter

describe('Événements de sécurité', () => {
  it('une ouverture de session de domaine inscrit 4768, 4769 (contrôleur) et 4624 (poste) avec le compte', () => {
    const s = logon(buildReferenceLab(), 'Azerty123!')
    const events = securityEvents(s)
    const tgs = events.find((e) => e.eventId === 4769)
    expect(tgs?.deviceName).toBe('SRV1')
    expect(tgs?.account).toBe('LAB\\jdupont')
    expect(tgs?.message).toContain('PC1$')
    expect(events.find((e) => e.eventId === 4624)?.deviceName).toBe('PC1')
    expect(events.filter((e) => e.account === 'LAB\\jdupont').map((e) => e.eventId)).toEqual(
      expect.arrayContaining([4768, 4769, 4624])
    )
  })

  it('les affichages prédéfinis isolent échecs, tickets Kerberos et privilèges', () => {
    let s = logon(buildReferenceLab(), 'faux')
    s = logon(s, 'Azerty123!')
    expect(
      securityEvents(s, view('logonFailures'))
        .map((e) => e.eventId)
        .sort()
    ).toEqual([4625, 4771])
    expect(securityEvents(s, view('kerberos')).map((e) => e.eventId)).toEqual([4768, 4769])
    expect(securityEvents(s, view('lockouts'))).toEqual([])
  })
})

describe('Corrélation', () => {
  it('3 échecs puis un succès lèvent une alerte, 2 échecs non', () => {
    let s = buildReferenceLab()
    for (let i = 0; i < 2; i++) s = logon(s, 'faux')
    expect(detectAlerts(logon(s, 'Azerty123!')).filter((a) => a.rule === 'failuresThenSuccess')).toEqual([])
    s = logon(s, 'faux')
    s = logon(s, 'Azerty123!')
    const alerts = detectAlerts(s).filter((a) => a.rule === 'failuresThenSuccess')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.account).toBe('LAB\\jdupont')
    // 3 tentatives (une par mot de passe erroné, 4625 et 4771 non comptés deux fois) + le succès
    expect(alerts[0]!.events).toHaveLength(4)
  })

  it('les échecs trop anciens (hors fenêtre) ne comptent pas', () => {
    let s = buildReferenceLab()
    for (let i = 0; i < 3; i++) s = logon(s, 'faux')
    s = { ...s, clock: s.clock + HOUR }
    s = logon(s, 'Azerty123!')
    expect(detectAlerts(s).filter((a) => a.rule === 'failuresThenSuccess')).toEqual([])
  })

  it('hors horaires : nuit et week-end, pas en journée de semaine', () => {
    // Le lab démarre le lundi 5 janvier 2026 à 8 h
    expect(isOffHours(0)).toBe(false)
    expect(isOffHours(11 * HOUR)).toBe(true) // lundi 19 h
    expect(isOffHours(-2 * HOUR + 24 * HOUR)).toBe(true) // mardi 6 h
    expect(isOffHours(5 * 24 * HOUR + 2 * HOUR)).toBe(true) // samedi 10 h
    let s = logon(buildReferenceLab(), 'Azerty123!')
    expect(detectAlerts(s).filter((a) => a.rule === 'offHours')).toEqual([])
    s = logoff(s)
    s = { ...s, clock: s.clock + 14 * HOUR }
    s = logon(s, 'Azerty123!')
    const night = detectAlerts(s).filter((a) => a.rule === 'offHours')
    expect(night).toHaveLength(1)
    expect(night[0]!.events[0]!.deviceName).toBe('PC1')
  })

  it('critère detectionAlert (compte complet ou nom seul, présence ou absence)', () => {
    let s = buildReferenceLab()
    for (let i = 0; i < 3; i++) s = logon(s, 'faux')
    s = logon(s, 'Azerty123!')
    const checks = [
      { type: 'detectionAlert', rule: 'failuresThenSuccess', account: 'jdupont', present: true },
      { type: 'detectionAlert', rule: 'failuresThenSuccess', account: 'LAB\\jdupont', present: true },
      { type: 'detectionAlert', rule: 'offHours', present: false },
      { type: 'detectionAlert', rule: 'failuresThenSuccess', account: 'admin', present: true }
    ].map((c) => CheckSchema.parse(c))
    expect(checks.map((c) => evaluateCheck(s, c))).toEqual([true, true, true, false])
  })
})
