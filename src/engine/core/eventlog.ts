/**
 * Journal d'événements des serveurs et postes (Observateur d'événements simplifié).
 */
import type { Draft } from 'immer'
import type { EventLogEntry, LabState } from '../model/schema'
import { nextSeq } from '../model/factory'

/** Nombre maximal d'entrées conservées par équipement. */
export const EVENT_LOG_LIMIT = 500

/** Écart de temps simulé entre deux événements consécutifs (ms). */
const EVENT_TICK_MS = 1000

export type NewEvent = Omit<EventLogEntry, 'id' | 'time' | 'log'> & { log?: EventLogEntry['log'] }

/** Ajoute une entrée au journal d'un serveur ou poste (sans effet pour les autres équipements). */
export function logEvent(draft: Draft<LabState>, deviceId: string, event: NewEvent): void {
  const device = draft.devices[deviceId]
  if (!device || (device.kind !== 'server' && device.kind !== 'client')) return
  draft.clock += EVENT_TICK_MS
  device.host.eventLog.push({ log: 'Système', ...event, id: nextSeq(draft), time: draft.clock })
  if (device.host.eventLog.length > EVENT_LOG_LIMIT)
    device.host.eventLog.splice(0, device.host.eventLog.length - EVENT_LOG_LIMIT)
}
