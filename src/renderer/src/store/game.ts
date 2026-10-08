/**
 * Partie Red/Blue en cours : l'état de la partie (moteur `cyber/game.ts`) et le minuteur. Les coups
 * passent par des commandes nommées exécutées par le store du lab (le canvas, l'historique et le
 * mode Simulation voient donc les mêmes changements qu'une manipulation à la main).
 */
import { create } from 'zustand'
import {
  aiBlueMove,
  aiPrepMoves,
  commandsFor,
  createGame,
  endGame,
  endTurn,
  redMove,
  setRedPlan,
  settle,
  startGame,
  type GameState,
  type Move,
  type Side,
  type StepRecord
} from '@engine/index'
import { useLabStore } from './lab'

interface GameStore {
  open: boolean
  game: GameState | null
  /** Lab au début de la partie (référence du score). */
  seconds: number | null

  openDialog: () => void
  closeDialog: () => void
  create: (side: Side, seed: number) => void
  setPlan: (ids: string[]) => void
  /** Joueur Blue : durcit pendant la préparation. */
  hardenInPrep: (id: string) => void
  begin: () => void
  /** Joue un tour ; `blue` : coup du joueur Blue (omis si le joueur est Red). */
  playTurn: (blue?: Move) => void
  /** Un tick du minuteur (une seconde). */
  tick: () => void
  giveUp: () => void
  reset: () => void
}

/** Exécute un coup par les commandes du lab et le comptabilise. */
function execute(game: GameState, side: Side, move: Move): GameState {
  const lab = useLabStore.getState()
  // Budget de contre-mesures épuisé : coup refusé
  if (move.kind === 'harden' && game.hardened.length >= game.blueBudget) return game
  const before = lab.lab
  const records: StepRecord[] = []
  let ok = true
  for (const cmd of commandsFor(move)) {
    const r = useLabStore.getState().dispatch(cmd)
    if (!r.ok) {
      ok = false
      break
    }
    if (cmd.type === 'cyber.playStep') records.push(r.value as StepRecord)
  }
  return settle(game, side, move, { ok, before, after: useLabStore.getState().lab, records })
}

export const useGameStore = create<GameStore>()((set, get) => ({
  open: false,
  game: null,
  seconds: null,

  openDialog: () => set({ open: true }),
  closeDialog: () => set({ open: false }),

  create: (side, seed) => {
    const lab = useLabStore.getState().lab
    set({ game: createGame(lab, { side, seed }), seconds: lab.cyber.game.timerSeconds })
  },

  setPlan: (ids) => {
    const game = get().game
    if (game) set({ game: setRedPlan(game, ids, useLabStore.getState().lab) })
  },

  hardenInPrep: (id) => {
    const game = get().game
    if (game?.phase === 'prep' && game.side === 'blue')
      set({ game: execute(game, 'blue', { kind: 'harden', id }) })
  },

  begin: () => {
    let game = get().game
    if (!game || game.phase !== 'prep') return
    // L'IA Blue durcit pendant la préparation du joueur Red
    for (const move of aiPrepMoves(game)) game = execute(game, 'blue', move)
    set({ game: startGame(game) })
  },

  playTurn: (blue) => {
    let game = get().game
    if (!game || game.phase !== 'running') return
    const red = redMove(game)
    if (red) game = execute(game, 'red', red)
    game = execute(game, 'blue', blue ?? aiBlueMove(game))
    set({ game: endTurn(game) })
  },

  tick: () => {
    const { game, seconds } = get()
    if (!game || game.phase === 'over' || seconds === null) return
    if (game.phase === 'prep') return
    if (seconds <= 1) set({ seconds: 0, game: endGame(game, 'timeout') })
    else set({ seconds: seconds - 1 })
  },

  giveUp: () => {
    const game = get().game
    if (game) set({ game: endGame(game, 'completed') })
  },

  reset: () => set({ game: null, seconds: null })
}))
