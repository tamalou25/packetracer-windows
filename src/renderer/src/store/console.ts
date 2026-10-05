/**
 * État des consoles ouvertes (une par équipement et par interpréteur) :
 * historique, défilement, session du moteur et saisie interactive en cours.
 */
import { create } from 'zustand'
import type { LabState, LineKind, ShellKind, ShellPrompt, ShellSession } from '@engine/index'

export interface TermLine {
  id: number
  text: string
  kind: LineKind | 'input'
}

/** Saisie demandée par une commande en cours (mot de passe, confirmation, paramètre). */
export interface PendingPrompt {
  prompt: ShellPrompt
  line: string
  answers: string[]
  /** Nombre de lignes de sortie déjà affichées pour cette commande. */
  displayed: number
  base: LabState
  session: ShellSession
}

export interface Terminal {
  key: string
  deviceId: string
  kind: ShellKind
  session: ShellSession | null
  lines: TermLine[]
  history: string[]
  pending: PendingPrompt | null
  /** Commande en attente de fin de simulation. */
  busy: boolean
}

const MAX_LINES = 2000
let lineSeq = 0

export function terminalKey(deviceId: string, kind: ShellKind): string {
  return `${deviceId}:${kind}`
}

interface ConsoleState {
  terminals: Record<string, Terminal>
  ensure: (deviceId: string, kind: ShellKind, init: () => { session: ShellSession; banner: string[] }) => void
  append: (key: string, lines: { text: string; kind: TermLine['kind'] }[]) => void
  clear: (key: string) => void
  update: (key: string, patch: Partial<Terminal>) => void
  pushHistory: (key: string, line: string) => void
  removeDevice: (deviceId: string) => void
  reset: () => void
}

export const useConsoleStore = create<ConsoleState>()((set, get) => ({
  terminals: {},

  ensure: (deviceId, kind, init) => {
    const key = terminalKey(deviceId, kind)
    if (get().terminals[key]) return
    const { session, banner } = init()
    set((s) => ({
      terminals: {
        ...s.terminals,
        [key]: {
          key,
          deviceId,
          kind,
          session,
          lines: banner.map((text) => ({ id: ++lineSeq, text, kind: 'out' as const })),
          history: [],
          pending: null,
          busy: false
        }
      }
    }))
  },

  append: (key, lines) =>
    set((s) => {
      const t = s.terminals[key]
      if (!t) return {}
      const added = lines.map((l) => ({ id: ++lineSeq, text: l.text, kind: l.kind }))
      return {
        terminals: { ...s.terminals, [key]: { ...t, lines: [...t.lines, ...added].slice(-MAX_LINES) } }
      }
    }),

  clear: (key) =>
    set((s) => {
      const t = s.terminals[key]
      return t ? { terminals: { ...s.terminals, [key]: { ...t, lines: [] } } } : {}
    }),

  update: (key, patch) =>
    set((s) => {
      const t = s.terminals[key]
      return t ? { terminals: { ...s.terminals, [key]: { ...t, ...patch } } } : {}
    }),

  pushHistory: (key, line) =>
    set((s) => {
      const t = s.terminals[key]
      if (!t || line.trim() === '' || t.history[t.history.length - 1] === line) return {}
      return { terminals: { ...s.terminals, [key]: { ...t, history: [...t.history, line].slice(-200) } } }
    }),

  removeDevice: (deviceId) =>
    set((s) => ({
      terminals: Object.fromEntries(Object.entries(s.terminals).filter(([, t]) => t.deviceId !== deviceId))
    })),

  reset: () => set({ terminals: {} })
}))
