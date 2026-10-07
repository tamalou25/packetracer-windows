/**
 * Mode examen : chronomètre, indices désactivés, vérification finale unique et note détaillée.
 * Toute sortie du mode examen (application quittée, examen abandonné, temps écoulé) est consignée
 * et figure dans le résultat. Le temps réel est fourni par l'appelant (le moteur ne lit pas
 * l'horloge système).
 */
import type { LabState } from '../model/schema'
import { evaluateCriteria } from './criteria'
import type { LabDefinition } from './lab'

export type ExamEventType =
  | 'start'
  /** L'application a perdu le focus (autre fenêtre, autre application). */
  | 'leave'
  | 'return'
  /** Examen quitté avant la fin (lab fermé, autre document ouvert). */
  | 'abandon'
  | 'timeout'
  | 'finish'

export interface ExamEvent {
  type: ExamEventType
  /** Horodatage réel (ms). */
  at: number
}

export interface ExamSession {
  labId: string
  labTitle: string
  /** Durée allouée (minutes). */
  minutes: number
  startedAt: number
  events: ExamEvent[]
}

export interface ExamCriterionResult {
  id: string
  label: string
  ok: boolean
}

export interface ExamResult {
  labId: string
  labTitle: string
  passed: number
  total: number
  /** Note sur 20, au dixième. */
  grade: number
  criteria: ExamCriterionResult[]
  minutes: number
  /** Temps passé (ms) jusqu'à la vérification finale. */
  elapsedMs: number
  /** Fin de l'examen : terminé par l'étudiant, temps écoulé ou abandon. */
  ending: 'finish' | 'timeout' | 'abandon'
  /** Sorties du mode examen (perte de focus, abandon, temps écoulé), horodatées. */
  exits: ExamEvent[]
  startedAt: number
}

/** « 25 min », « 1 h 30 », « 2 h » → minutes (30 par défaut). */
export function durationMinutes(text: string): number {
  const hours = /(\d+)\s*h/i.exec(text)
  const minutes = /(\d+)\s*min/i.exec(text) ?? /h\s*(\d+)/i.exec(text)
  const total = (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0)
  return total > 0 ? total : 30
}

export function startExam(
  lab: LabDefinition,
  now: number,
  minutes = durationMinutes(lab.duration)
): ExamSession {
  return {
    labId: lab.id,
    labTitle: lab.title,
    minutes,
    startedAt: now,
    events: [{ type: 'start', at: now }]
  }
}

/** Temps restant (ms, 0 si écoulé). */
export function remainingMs(session: ExamSession, now: number): number {
  return Math.max(0, session.startedAt + session.minutes * 60_000 - now)
}

/** Consigne un évènement (perte ou retour du focus) ; ignoré si l'examen est terminé. */
export function recordExamEvent(session: ExamSession, type: 'leave' | 'return', at: number): ExamSession {
  if (session.events.some((e) => e.type === 'finish' || e.type === 'abandon' || e.type === 'timeout'))
    return session
  const last = [...session.events].reverse().find((e) => e.type === 'leave' || e.type === 'return')
  // Deux pertes de focus de suite sans retour : une seule sortie
  if (last?.type === type || (type === 'return' && !last)) return session
  return { ...session, events: [...session.events, { type, at }] }
}

/**
 * Vérification finale unique : note détaillée par critère. `ending` indique comment l'examen
 * s'est terminé ; un dépassement du temps imparti est consigné comme fin par temps écoulé.
 */
export function finishExam(
  session: ExamSession,
  state: LabState,
  lab: LabDefinition,
  now: number,
  ending: ExamResult['ending'] = 'finish'
): ExamResult {
  const deadline = session.startedAt + session.minutes * 60_000
  const end = ending === 'finish' && now > deadline ? 'timeout' : ending
  const at = end === 'timeout' ? Math.min(now, deadline) : now
  const results = evaluateCriteria(state, lab.criteria)
  const criteria = lab.criteria.map((c, i) => ({ id: c.id, label: c.label, ok: results[i]?.ok ?? false }))
  const passed = criteria.filter((c) => c.ok).length
  const total = criteria.length
  const events = [...session.events, { type: end, at } satisfies ExamEvent]
  return {
    labId: session.labId,
    labTitle: session.labTitle,
    passed,
    total,
    grade: total === 0 ? 0 : Math.round((passed / total) * 200) / 10,
    criteria,
    minutes: session.minutes,
    elapsedMs: at - session.startedAt,
    ending: end,
    exits: events.filter((e) => e.type === 'leave' || e.type === 'abandon' || e.type === 'timeout'),
    startedAt: session.startedAt
  }
}

/** « 12 min 05 s » */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(s / 60)
  return `${m} min ${String(s % 60).padStart(2, '0')} s`
}

const ENDINGS: Record<ExamResult['ending'], string> = {
  finish: 'terminé par le candidat',
  timeout: 'temps écoulé',
  abandon: 'abandonné avant la fin'
}

const EXIT_LABELS: Record<ExamEventType, string> = {
  start: 'Début',
  leave: 'Application quittée (perte du focus)',
  return: 'Retour dans l’application',
  abandon: 'Examen abandonné',
  timeout: 'Temps écoulé',
  finish: 'Fin'
}

/**
 * Résultat exporté (texte). `formatTime` met en forme un horodatage réel (fourni par l'appelant,
 * selon le fuseau de l'utilisateur).
 */
export function examResultText(result: ExamResult, formatTime: (at: number) => string): string {
  const lines = [
    `Résultat d’examen — ${result.labTitle}`,
    '',
    `Note : ${String(result.grade).replace('.', ',')} / 20 (${result.passed} critère(s) validé(s) sur ${result.total})`,
    `Début : ${formatTime(result.startedAt)}`,
    `Durée : ${formatDuration(result.elapsedMs)} sur ${result.minutes} min allouées`,
    `Fin : ${ENDINGS[result.ending]}`,
    '',
    'Critères :',
    ...result.criteria.map((c) => `  [${c.ok ? 'OK' : 'KO'}] ${c.label}`),
    '',
    result.exits.length === 0
      ? 'Sorties du mode examen : aucune.'
      : `Sorties du mode examen (${result.exits.length}) :`,
    ...result.exits.map((e) => `  ${formatTime(e.at)} — ${EXIT_LABELS[e.type]}`),
    ''
  ]
  return lines.join('\n')
}
