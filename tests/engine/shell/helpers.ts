/**
 * Aides pour tester les consoles : exécute une ligne en répondant aux invites.
 */
import {
  createShellSession,
  executeLine,
  type LabState,
  type ShellKind,
  type ShellSession
} from '@engine/index'

export interface RunResult {
  state: LabState
  session: ShellSession
  text: string
  errors: string
  prompts: string[]
  traceEvents: number
}

export function run(
  state: LabState,
  deviceId: string,
  line: string,
  opts: { shell?: ShellKind; answers?: string[]; session?: ShellSession } = {}
): RunResult {
  const session = opts.session ?? createShellSession(state, deviceId, opts.shell ?? 'powershell')
  const answers: string[] = []
  const pending = [...(opts.answers ?? [])]
  const prompts: string[] = []
  for (;;) {
    const r = executeLine(state, session, line, answers)
    if (r.prompt) {
      prompts.push(r.prompt.message)
      const next = pending.shift()
      if (next === undefined) throw new Error(`Invite sans réponse : ${r.prompt.message}`)
      answers.push(next)
      continue
    }
    return {
      state: r.state,
      session: r.session,
      text: r.output.map((l) => l.text).join('\n'),
      errors: r.output
        .filter((l) => l.kind === 'error')
        .map((l) => l.text)
        .join('\n'),
      prompts,
      traceEvents: r.trace?.events.length ?? 0
    }
  }
}
