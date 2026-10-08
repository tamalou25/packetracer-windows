/**
 * Console IOS d'un routeur ou d'un switch Cisco : point d'entrée appelé par `executeLine`.
 * Interpréteur indépendant de PowerShell, cmd et bash.
 */
import type { LabState } from '../../model/schema'
import type { OutputLine, ShellResult, ShellSession } from '../../shell/types'

/** Vrai si l'équipement est un routeur ou un switch Cisco IOS. */
export function isIosDevice(state: LabState, deviceId: string): boolean {
  const d = state.devices[deviceId]
  return (d?.kind === 'router' || d?.kind === 'switch') && d.model !== undefined
}

/** Invite IOS : nom d'hôte suivi du mode (> en mode utilisateur). */
export function iosPrompt(session: ShellSession, state?: LabState): string {
  const name = state?.devices[session.deviceId]?.name ?? 'Router'
  return `${name}>`
}

/** Texte affiché à l'ouverture de la console (ligne console après le démarrage). */
export const IOS_BANNER = ['', 'Press RETURN to get started!', '']

/** Exécute une ligne saisie dans la console IOS. */
export function executeIos(state: LabState, session: ShellSession, line: string): ShellResult {
  const output: OutputLine[] = []
  const word = line.trim()
  if (word !== '') {
    // Mode utilisateur : un mot inconnu est pris pour un nom d'hôte (connexion Telnet implicite)
    output.push({
      text: `Translating "${word.split(/\s+/)[0]}"...domain server (255.255.255.255)`,
      kind: 'out'
    })
    output.push({
      text: '% Unknown command or computer name, or unable to find computer address',
      kind: 'error'
    })
  }
  return { state, session, output, trace: null, clear: false, prompt: null, exit: false }
}
