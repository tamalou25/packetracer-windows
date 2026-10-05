/**
 * Point d'entrée des consoles : création de session, invite, exécution d'une ligne.
 */
import { DEFAULT_LOCAL_USER } from '../model/factory'
import type { LabState } from '../model/schema'
import { CATALOG } from './catalog'
import { executeCmd } from './cmd/interpreter'
import { CommandFailure } from './context'
import { CmdContext, executePowerShell } from './ps/interpreter'
import { NeedInput, type ShellKind, type ShellResult, type ShellSession } from './types'

function sessionUser(state: LabState, deviceId: string): string {
  const d = state.devices[deviceId]
  if (!d || (d.kind !== 'server' && d.kind !== 'client')) return 'Administrateur'
  return d.host.session?.user ?? DEFAULT_LOCAL_USER[d.kind]
}

export function createShellSession(state: LabState, deviceId: string, kind: ShellKind): ShellSession {
  return { deviceId, stack: [kind], cwd: `C:\\Users\\${sessionUser(state, deviceId)}`, variables: {} }
}

/** Interpréteur actif de la session. */
export function activeShell(session: ShellSession): ShellKind {
  return session.stack[session.stack.length - 1] ?? 'cmd'
}

/** Invite affichée avant la saisie. */
export function shellPrompt(session: ShellSession): string {
  return activeShell(session) === 'powershell' ? `PS ${session.cwd}> ` : `${session.cwd}>`
}

/** Texte d'accueil d'une nouvelle console. */
export function shellBanner(kind: ShellKind): string[] {
  return kind === 'powershell'
    ? [
        'PowerShell (simulé) — ServerLab',
        'Tapez Get-Command pour la liste des commandes, Get-Help <commande> pour l’aide.',
        ''
      ]
    : ['Invite de commandes (simulée) — ServerLab', 'Tapez help pour la liste des commandes.', '']
}

/**
 * Exécute une ligne de commande.
 * `answers` : réponses déjà fournies aux saisies interactives (la ligne est rejouée à l'identique).
 */
export function executeLine(
  state: LabState,
  session: ShellSession,
  line: string,
  answers: string[] = []
): ShellResult {
  const ctx = new CmdContext(state, session, answers, CATALOG, line)
  const base = { trace: null, clear: false, prompt: null, exit: false }
  const device = state.devices[session.deviceId]
  if (!device || !device.powered) {
    return { ...base, state, session, output: [{ text: 'L’ordinateur est éteint.', kind: 'error' }] }
  }
  try {
    const kind = activeShell(session)
    if (kind === 'powershell') {
      if (line.trim().toLowerCase() === 'exit') {
        if (session.stack.length > 1) ctx.session = { ...session, stack: session.stack.slice(0, -1) }
        else ctx.exit = true
      } else {
        executePowerShell(ctx, line)
      }
    } else {
      executeCmd(ctx, line, CATALOG.tools)
    }
  } catch (e) {
    if (e instanceof NeedInput) {
      return { ...base, state, session, output: ctx.output, prompt: e.prompt }
    }
    if (e instanceof CommandFailure) {
      ctx.write(e.message, 'error')
    } else {
      throw e
    }
  }
  return {
    state: ctx.state,
    session: ctx.session,
    output: ctx.output,
    trace: ctx.mergedTrace(line.trim()),
    clear: ctx.clear,
    prompt: null,
    exit: ctx.exit
  }
}
