/**
 * Console IOS des routeurs et switchs Cisco : interpréteur indépendant de PowerShell, cmd et bash.
 */
import type { LabState } from '../../model/schema'
import type { ShellSession } from '../../shell/types'
import { completeWord, helpLines } from './parser'
import { iosSessionOf } from './session'
import { modeTree } from './tree'

import { executeIos } from './exec'

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

/**
 * Exécute un script de console IOS (lab de départ) : les lignes sont saisies comme à la main, sans
 * invite. Une erreur de syntaxe ou une question interactive interrompt la construction du lab.
 */
export function runIosScript(state: LabState, deviceId: string, lines: readonly string[]): LabState {
  let current = state
  let session: ShellSession = { deviceId, stack: ['ios'], cwd: '', variables: {} }
  for (const line of lines) {
    const result = executeIos(current, session, line)
    if (result.prompt)
      throw new Error(`Script IOS de ${deviceId} : saisie interactive inattendue (« ${line} »).`)
    // Messages d'erreur IOS (« % … ») ; les messages syslog (%LINK-3-UPDOWN: …) et les
    // informations (« % Generating 1024 bit RSA keys… ») ne sont pas des erreurs
    const error = result.output.find(
      (o) =>
        o.text.startsWith('%') &&
        !/^%[A-Z0-9_]+-\d-[A-Z0-9_]+:/.test(o.text) &&
        !/^% (Generating|The key modulus|Please define a domain)/.test(o.text)
    )
    if (error) throw new Error(`Script IOS de ${deviceId} : « ${line} » → ${error.text}`)
    current = result.state
    session = result.session
  }
  return current
}
