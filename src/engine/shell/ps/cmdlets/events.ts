/**
 * Get-WinEvent : lecture des journaux de l'ordinateur (-LogName, -FilterHashtable, -MaxEvents).
 */
import { formatShortDate, parseLabDate } from '../../../core/clock'
import { filterEvents, type EventFilter } from '../../../core/eventlog'
import type { EventLogEntry } from '../../../model/schema'
import { psError } from '../errors'
import type { CmdletDef } from '../registry'
import { flatten, isPsObject, psObject, psToString, type PsValue } from '../values'

/** Noms anglais (Get-WinEvent) et français des journaux. */
const LOGS: Record<string, EventLogEntry['log']> = {
  security: 'Sécurité',
  sécurité: 'Sécurité',
  system: 'Système',
  système: 'Système',
  application: 'Application',
  'directory service': 'Service d’annuaire',
  'service d’annuaire': 'Service d’annuaire',
  "service d'annuaire": 'Service d’annuaire',
  'dns server': 'Serveur DNS',
  'serveur dns': 'Serveur DNS'
}

/** Niveaux numériques de -FilterHashtable (Level). */
const LEVELS: Record<number, EventLogEntry['level']> = { 2: 'error', 3: 'warning', 4: 'information' }
const LEVEL_NAMES: Record<EventLogEntry['level'], string> = {
  information: 'Information',
  warning: 'Avertissement',
  error: 'Erreur'
}

function logOf(value: PsValue | undefined): EventLogEntry['log'] {
  const name = psToString(value ?? '').trim()
  const log = LOGS[name.toLowerCase()]
  if (!log)
    throw psError(
      `Aucun journal des événements ne correspond à « ${name} » sur cet ordinateur.`,
      'ObjectNotFound',
      'NoMatchingLogsFound,Microsoft.PowerShell.Commands.GetWinEventCommand'
    )
  return log
}

function dateOf(value: PsValue | undefined): number | null {
  if (value === undefined) return null
  const clock = parseLabDate(psToString(value))
  if (clock === null)
    throw psError(
      `Date « ${psToString(value)} » non reconnue : utilisez le format JJ/MM/AAAA HH:MM.`,
      'InvalidArgument',
      'InvalidDate'
    )
  return clock
}

export const eventCmdlets: CmdletDef[] = [
  {
    name: 'Get-WinEvent',
    module: 'Diagnostics',
    synopsis: 'Lit les événements d’un journal (filtrage par ID, niveau, source, date).',
    params: [
      { name: 'LogName', type: 'string', position: 0 },
      { name: 'FilterHashtable', type: 'any' },
      { name: 'MaxEvents', type: 'int' },
      { name: 'Oldest', type: 'switch' }
    ],
    run(ctx, args) {
      let log: EventLogEntry['log']
      const filter: EventFilter = {}
      const hash = args['FilterHashtable']
      if (hash !== undefined) {
        if (!isPsObject(hash))
          throw psError(
            '-FilterHashtable attend une table de hachage @{ … }.',
            'InvalidArgument',
            'InvalidHashtable'
          )
        const get = (key: string) =>
          Object.entries(hash.props).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1]
        log = logOf(get('LogName'))
        const ids = get('Id')
        if (ids !== undefined) filter.ids = flatten([ids]).map((v) => Number(psToString(v)))
        const level = get('Level')
        if (level !== undefined)
          filter.levels = flatten([level]).flatMap((v) => {
            const l = LEVELS[Number(psToString(v))]
            return l ? [l] : []
          })
        const provider = get('ProviderName')
        if (provider !== undefined) filter.sources = flatten([provider]).map(psToString)
        filter.since = dateOf(get('StartTime'))
        filter.until = dateOf(get('EndTime'))
      } else {
        if (args['LogName'] === undefined)
          throw psError('Indiquez -LogName ou -FilterHashtable.', 'InvalidArgument', 'ParameterSetRequired')
        log = logOf(args['LogName'])
      }
      let entries = filterEvents(
        ctx.host.host.eventLog.filter((e) => e.log === log),
        filter
      )
      if (args['Oldest'] !== true) entries = [...entries].reverse()
      if (args['MaxEvents'] !== undefined) entries = entries.slice(0, Number(args['MaxEvents']))
      if (entries.length === 0)
        throw psError(
          'Aucun événement correspondant aux critères de sélection spécifiés n’a été trouvé.',
          'ObjectNotFound',
          'NoMatchingEventsFound,Microsoft.PowerShell.Commands.GetWinEventCommand'
        )
      return entries.map((e) =>
        psObject(
          'System.Diagnostics.Eventing.Reader.EventLogRecord',
          {
            TimeCreated: formatShortDate(e.time),
            Id: e.eventId,
            LevelDisplayName: LEVEL_NAMES[e.level],
            ProviderName: e.source,
            LogName: e.log,
            Message: e.message
          },
          { kind: 'table', props: ['TimeCreated', 'Id', 'LevelDisplayName', 'Message'] }
        )
      )
    }
  }
]
