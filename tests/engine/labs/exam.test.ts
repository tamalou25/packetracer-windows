/**
 * Mode examen : durée allouée, temps restant, sorties consignées, vérification finale unique
 * (note détaillée), fin par temps écoulé ou abandon, résultat exporté.
 */
import { describe, expect, it } from 'vitest'
import {
  buildLabStart,
  durationMinutes,
  examResultText,
  finishExam,
  formatDuration,
  parseLab,
  recordExamEvent,
  remainingMs,
  setInterfaceIpv4,
  startExam,
  unwrap,
  type LabDefinition,
  type LabState
} from '@engine/index'
import lab01Json from '../../../labs/lab-01-adressage.json'

const T0 = Date.UTC(2026, 9, 7, 8, 0, 0)
const MIN = 60_000

function lab01(): LabDefinition {
  const parsed = parseLab(lab01Json)
  if (!parsed.ok) throw new Error(parsed.message)
  return parsed.lab
}

/** Solution du lab 1 : adresses du routeur et des postes. */
function solveLab01(s: LabState): LabState {
  const set = (
    state: LabState,
    device: string,
    port: string | null,
    address: string,
    gateway: string | null
  ) => {
    const d = Object.values(state.devices).find((x) => x.name === device)!
    const iface = port ? d.interfaces.find((i) => i.name === port)! : d.interfaces.find((i) => i.l3)!
    return unwrap(
      setInterfaceIpv4(state, d.id, iface.id, {
        addressing: 'static',
        address,
        mask: '24',
        gateway,
        dnsServers: []
      })
    ).state
  }
  s = set(s, 'R1', 'Gi0/0', '192.168.10.254', null)
  s = set(s, 'R1', 'Gi0/1', '192.168.20.254', null)
  s = set(s, 'PC1', null, '192.168.10.10', '192.168.10.254')
  return set(s, 'PC2', null, '192.168.20.10', '192.168.20.254')
}

describe('Mode examen', () => {
  it('durée allouée tirée de la durée indicative', () => {
    expect(durationMinutes('25 min')).toBe(25)
    expect(durationMinutes('1 h 30')).toBe(90)
    expect(durationMinutes('2 h')).toBe(120)
    expect(durationMinutes('1 h 15 min')).toBe(75)
    expect(durationMinutes('bientôt')).toBe(30)
  })

  it('chronomètre : temps restant, jamais négatif', () => {
    const s = startExam(lab01(), T0)
    expect(s.minutes).toBe(20)
    expect(remainingMs(s, T0 + 5 * MIN)).toBe(15 * MIN)
    expect(remainingMs(s, T0 + 30 * MIN)).toBe(0)
  })

  it('note détaillée par critère : départ 0 / 20, solution 20 / 20', () => {
    const lab = lab01()
    const s = startExam(lab, T0)
    const start = buildLabStart(lab.start)
    const zero = finishExam(s, start, lab, T0 + 5 * MIN)
    expect(zero).toMatchObject({
      passed: 0,
      total: lab.criteria.length,
      grade: 0,
      ending: 'finish',
      exits: []
    })
    expect(zero.criteria.map((c) => c.id)).toEqual(lab.criteria.map((c) => c.id))
    const full = finishExam(s, solveLab01(start), lab, T0 + 12 * MIN)
    expect(full.grade).toBe(20)
    expect(full.elapsedMs).toBe(12 * MIN)
  })

  it('note au dixième', () => {
    const lab = lab01()
    const solved = solveLab01(buildLabStart(lab.start))
    // Un critère sur sept non validé : 6 / 7 × 20 = 17,1
    const partial = {
      ...lab,
      criteria: [...lab.criteria, { ...lab.criteria[0]!, id: 'x', check: { type: 'auditScore', min: 101 } }]
    }
    const r = finishExam(startExam(partial, T0), solved, partial, T0 + MIN)
    expect(r.grade).toBe(Math.round((r.passed / r.total) * 200) / 10)
    expect(r.passed).toBe(r.total - 1)
  })

  it('sorties consignées : perte de focus (une seule par absence), retour, abandon', () => {
    const lab = lab01()
    let s = startExam(lab, T0)
    s = recordExamEvent(s, 'return', T0 + MIN) // retour sans départ : ignoré
    s = recordExamEvent(s, 'leave', T0 + 2 * MIN)
    s = recordExamEvent(s, 'leave', T0 + 3 * MIN) // déjà sorti : ignoré
    s = recordExamEvent(s, 'return', T0 + 4 * MIN)
    expect(s.events.map((e) => e.type)).toEqual(['start', 'leave', 'return'])
    const r = finishExam(s, buildLabStart(lab.start), lab, T0 + 6 * MIN, 'abandon')
    expect(r.ending).toBe('abandon')
    expect(r.exits.map((e) => [e.type, e.at])).toEqual([
      ['leave', T0 + 2 * MIN],
      ['abandon', T0 + 6 * MIN]
    ])
  })

  it('vérification après l’échéance : fin par temps écoulé, durée bornée', () => {
    const lab = lab01()
    const r = finishExam(startExam(lab, T0), buildLabStart(lab.start), lab, T0 + 45 * MIN)
    expect(r.ending).toBe('timeout')
    expect(r.elapsedMs).toBe(20 * MIN)
    expect(r.exits.map((e) => e.type)).toEqual(['timeout'])
  })

  it('résultat exporté : note, critères, durée et sorties', () => {
    const lab = lab01()
    let s = startExam(lab, T0)
    s = recordExamEvent(s, 'leave', T0 + 2 * MIN)
    const r = finishExam(s, solveLab01(buildLabStart(lab.start)), lab, T0 + 10 * MIN + 5000)
    const text = examResultText(r, (at) => `T+${(at - T0) / MIN}`)
    expect(text).toContain('Note : 20 / 20 (7 critère(s) validé(s) sur 7)')
    expect(text).toContain('Durée : 10 min 05 s sur 20 min allouées')
    expect(text).toContain('Fin : terminé par le candidat')
    expect(text).toContain('[OK]')
    expect(text).toContain('Sorties du mode examen (1) :')
    expect(text).toContain('T+2 — Application quittée (perte du focus)')
    expect(formatDuration(65_000)).toBe('1 min 05 s')
  })
})
