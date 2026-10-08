/**
 * Détection dans les journaux de sécurité : affichages prédéfinis (filtres de l'Observateur
 * d'événements) et règles de corrélation simples appliquées aux journaux existants des serveurs et
 * postes. Aucune donnée n'est ajoutée à l'état : tout est calculé à partir des événements journalisés.
 */
import { filterEvents, type EventFilter } from '../core/eventlog'
import { LAB_EPOCH_MS } from '../core/clock'
import type { EventLogEntry, HostDevice, LabState } from '../model/schema'

/** Affichage personnalisé de l'Observateur d'événements (journal Sécurité). */
export interface DetectionView {
  id: string
  title: string
  description: string
  filter: EventFilter
}

/** Affichages fournis : ils isolent les événements utiles à l'analyse d'un incident. */
export const DETECTION_VIEWS: DetectionView[] = [
  {
    id: 'logonFailures',
    title: 'Échecs d’ouverture de session',
    description: 'Mots de passe erronés (4625) et pré-authentifications Kerberos refusées (4771).',
    filter: { ids: [4625, 4771] }
  },
  {
    id: 'lockouts',
    title: 'Comptes verrouillés',
    description: 'Verrouillages de comptes du domaine (4740), inscrits sur l’émulateur PDC.',
    filter: { ids: [4740] }
  },
  {
    id: 'kerberos',
    title: 'Tickets Kerberos',
    description: 'Demandes de TGT (4768) et de tickets de service (4769).',
    filter: { ids: [4768, 4769] }
  },
  {
    id: 'privileged',
    title: 'Ouvertures de session privilégiées',
    description: 'Privilèges spéciaux attribués à l’ouverture de session d’un administrateur (4672).',
    filter: { ids: [4672] }
  }
]

/** Événement d'un journal, avec l'ordinateur où il a été inscrit. */
export interface LocatedEvent extends EventLogEntry {
  deviceId: string
  deviceName: string
}

/** Alerte levée par une règle de corrélation. */
export interface DetectionAlert {
  rule: DetectionRuleId
  /** Compte concerné. */
  account: string
  /** Résumé en français. */
  detail: string
  /** Événements à l'origine de l'alerte (ordre chronologique). */
  events: LocatedEvent[]
}

export type DetectionRuleId = 'failuresThenSuccess' | 'offHours'

export interface DetectionOptions {
  /** Échecs consécutifs avant un succès pour lever l'alerte. */
  failures: number
  /** Fenêtre (ms) entre le premier échec et le succès. */
  windowMs: number
  /** Heures ouvrées [début, fin[ (heure du lab, 0-24). */
  workHours: [number, number]
}

export const DEFAULT_DETECTION: DetectionOptions = {
  failures: 3,
  windowMs: 30 * 60_000,
  workHours: [8, 19]
}

export const DETECTION_RULES: { id: DetectionRuleId; title: string; description: string }[] = [
  {
    id: 'failuresThenSuccess',
    title: 'Échecs puis succès',
    description:
      'Plusieurs échecs d’ouverture de session suivis d’un succès pour le même compte : mot de passe deviné ou retrouvé.'
  },
  {
    id: 'offHours',
    title: 'Activité hors horaires',
    description: 'Ouverture de session réussie la nuit ou le week-end.'
  }
]

const FAILURE_IDS = new Set([4625, 4771])
const SUCCESS_ID = 4624

const hosts = (state: LabState): HostDevice[] =>
  Object.values(state.devices).filter((d): d is HostDevice => d.kind === 'server' || d.kind === 'client')

/** Événements de sécurité de tout le lab, par ordre chronologique. */
export function securityEvents(state: LabState, filter: EventFilter = {}): LocatedEvent[] {
  return hosts(state)
    .flatMap((h) =>
      filterEvents(
        h.host.eventLog.filter((e) => e.log === 'Sécurité'),
        filter
      ).map((e) => ({ ...e, deviceId: h.id, deviceName: h.name }))
    )
    .sort((a, b) => a.time - b.time || a.id - b.id)
}

/** Heure et jour (0 = dimanche) du lab à l'horloge donnée. */
function labTime(clock: number): { hour: number; day: number } {
  const d = new Date(LAB_EPOCH_MS + clock)
  return { hour: d.getUTCHours(), day: d.getUTCDay() }
}

/** L'horloge tombe-t-elle hors des heures ouvrées (nuit ou week-end) ? */
export function isOffHours(
  clock: number,
  workHours: [number, number] = DEFAULT_DETECTION.workHours
): boolean {
  const { hour, day } = labTime(clock)
  return day === 0 || day === 6 || hour < workHours[0] || hour >= workHours[1]
}

/** Même compte : « LAB\\jdupont » correspond à « LAB\\jdupont » comme à « jdupont ». */
const sameAccount = (account: string, wanted: string): boolean => {
  const a = account.toLowerCase()
  const w = wanted.toLowerCase()
  return a === w || (!w.includes('\\') && a.endsWith(`\\${w}`))
}

/** Règle « N échecs puis 1 succès » : une alerte par succès précédé d'assez d'échecs récents. */
function failuresThenSuccess(events: LocatedEvent[], options: DetectionOptions): DetectionAlert[] {
  const alerts: DetectionAlert[] = []
  const pending = new Map<string, LocatedEvent[]>()
  for (const e of events) {
    if (!e.account) continue
    const key = e.account.toLowerCase()
    if (FAILURE_IDS.has(e.eventId)) {
      // Un même mot de passe erroné est inscrit sur le poste (4625) et sur le contrôleur (4771) :
      // on compte une tentative par 4625, ou par 4771 seul
      const list = pending.get(key) ?? []
      const duplicate = list.some((p) => p.eventId !== e.eventId && Math.abs(p.time - e.time) <= 5_000)
      if (!duplicate) list.push(e)
      pending.set(key, list)
    } else if (e.eventId === SUCCESS_ID) {
      const recent = (pending.get(key) ?? []).filter((f) => e.time - f.time <= options.windowMs)
      if (recent.length >= options.failures)
        alerts.push({
          rule: 'failuresThenSuccess',
          account: e.account,
          detail: `${recent.length} échec(s) d’ouverture de session puis un succès pour ${e.account} sur ${e.deviceName}.`,
          events: [...recent, e]
        })
      pending.delete(key)
    }
  }
  return alerts
}

/** Règle « activité hors horaires » : ouverture de session réussie la nuit ou le week-end. */
function offHours(events: LocatedEvent[], options: DetectionOptions): DetectionAlert[] {
  return events
    .filter((e) => e.eventId === SUCCESS_ID && e.account && isOffHours(e.time, options.workHours))
    .map((e) => ({
      rule: 'offHours' as const,
      account: e.account ?? '',
      detail: `Ouverture de session de ${e.account} sur ${e.deviceName} en dehors des heures ouvrées.`,
      events: [e]
    }))
}

/** Alertes de corrélation sur l'ensemble des journaux Sécurité du lab. */
export function detectAlerts(state: LabState, options: Partial<DetectionOptions> = {}): DetectionAlert[] {
  const opts = { ...DEFAULT_DETECTION, ...options }
  const events = securityEvents(state)
  return [...failuresThenSuccess(events, opts), ...offHours(events, opts)]
}

/** Alertes d'une règle pour un compte (critères de lab). */
export function alertsFor(state: LabState, rule: DetectionRuleId, account?: string): DetectionAlert[] {
  return detectAlerts(state).filter((a) => a.rule === rule && (!account || sameAccount(a.account, account)))
}
