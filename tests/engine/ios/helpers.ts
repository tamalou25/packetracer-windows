/**
 * Aides des tests IOS : équipement Cisco et console qui enchaîne les lignes saisies.
 */
import {
  addDevice,
  createShellSession,
  executeLine,
  shellPrompt,
  unwrap,
  type IosModel,
  type LabState,
  type ShellSession
} from '@engine/index'
import { createLab } from '../helpers'

export function addIos(state: LabState, model: IosModel, name?: string): { state: LabState; id: string } {
  const kind = model === 'c1921' || model === 'c2811' ? 'router' : 'switch'
  const r = unwrap(addDevice(state, { kind, model, position: { x: 0, y: 0 }, ...(name ? { name } : {}) }))
  return { state: r.state, id: r.value }
}

/** Console IOS : run('conf t') renvoie les lignes affichées ; state et prompt suivent. */
export class IosConsole {
  session: ShellSession
  constructor(
    public state: LabState,
    deviceId: string
  ) {
    this.session = createShellSession(state, deviceId, 'ios')
  }

  get prompt(): string {
    return shellPrompt(this.session, this.state)
  }

  /** Exécute une ligne (réponses aux invites éventuelles) et renvoie la sortie. */
  run(line: string, answers: string[] = []): string[] {
    const r = executeLine(this.state, this.session, line, answers)
    if (r.prompt) throw new Error(`invite inattendue : ${r.prompt.message}`)
    this.state = r.state
    this.session = r.session
    return r.output.map((l) => l.text)
  }

  /** Enchaîne plusieurs lignes, renvoie la sortie de la dernière. */
  lines(...lines: string[]): string[] {
    let out: string[] = []
    for (const l of lines) out = this.run(l)
    return out
  }
}

/** Routeur 1921 neuf et sa console. */
export function router(model: IosModel = 'c1921'): IosConsole {
  const r = addIos(createLab(), model)
  return new IosConsole(r.state, r.id)
}
