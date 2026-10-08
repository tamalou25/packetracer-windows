/**
 * Journalisation IOS : tampon de messages syslog (`show logging`). Il reçoit les messages émis par
 * les fonctions de l'équipement (inspection ARP, DTP…) et par les scénarios de cybersécurité ;
 * il est perdu au redémarrage, comme le tampon d'un vrai switch.
 */
import type { Draft } from 'immer'
import { LAB_EPOCH_MS } from '../../core/clock'
import type { LabState } from '../../model/schema'
import type { ArgContext, CliCommand, SyntaxToken } from '../cli/types'
import { draftIosState, iosState } from '../config'
import { isIos } from '../device'
import { defineIosFeature } from '../feature'
import { deviceOf } from './base'

/** Nombre maximal de messages conservés. */
export const SYSLOG_LIMIT = 100

const kw = (keyword: string, help: string): SyntaxToken => ({ keyword, help })

const p2 = (n: number) => String(n).padStart(2, '0')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Horodatage IOS : « *Jan  5 08:00:03 ». */
function stamp(clock: number): string {
  const d = new Date(LAB_EPOCH_MS + clock)
  return `*${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2)} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`
}

/** Ajoute un message au tampon d'un équipement IOS (sans effet pour les autres équipements). */
export function appendSyslog(draft: Draft<LabState>, deviceId: string, message: string): void {
  const device = draft.devices[deviceId]
  if (!device || !isIos(device as never)) return
  const log = draftIosState(device as never).syslog
  log.push(`${stamp(draft.clock)}: ${message}`)
  if (log.length > SYSLOG_LIMIT) log.splice(0, log.length - SYSLOG_LIMIT)
}

const commands: CliCommand[] = [
  {
    modes: ['user', 'exec'],
    syntax: [
      kw('show', 'Show running system information'),
      kw('logging', 'Show the contents of logging buffers')
    ],
    available: (ctx: ArgContext) => isIos(ctx.state.devices[ctx.deviceId] as never),
    run: (ctx) => {
      const log = iosState(deviceOf(ctx)).syslog
      ctx.print(
        'Syslog logging: enabled (0 messages dropped, 0 messages rate-limited, 0 flushes, 0 overruns)'
      )
      ctx.print('    Console logging: level debugging')
      ctx.print('    Buffer logging: level debugging')
      ctx.print('')
      ctx.print(`Log Buffer (4096 bytes):`)
      ctx.print('')
      for (const line of log) ctx.print(line)
    }
  }
]

export const logging = defineIosFeature({ id: 'logging', commands })
