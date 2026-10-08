/**
 * Console IOS des routeurs et switchs Cisco : interpréteur indépendant de PowerShell, cmd et bash.
 */
import type { LabState } from '../../model/schema'
import type { ShellSession } from '../../shell/types'
import { completeWord, helpLines } from './parser'
import { iosSessionOf } from './session'
import { modeTree } from './tree'

export { executeIos, IOS_CTRL_Z, CONFIG_I_MESSAGE } from './exec'
export { iosPrompt, iosSessionOf, IOS_BANNER } from './session'
export type { IosMode, IosSession } from './types'

/** Aide `?` pour la saisie en cours (affichée sans valider la ligne). */
export function iosHelp(state: LabState, session: ShellSession, input: string): string[] {
  return helpLines(modeTree(iosSessionOf(session).mode), input, {
    state,
    deviceId: session.deviceId,
    session: iosSessionOf(session)
  })
}

/** Complétion Tab du dernier mot (null : ligne inchangée). */
export function iosComplete(
  state: LabState,
  session: ShellSession,
  input: string
): { start: number; word: string } | null {
  return completeWord(modeTree(iosSessionOf(session).mode), input, {
    state,
    deviceId: session.deviceId,
    session: iosSessionOf(session)
  })
}
