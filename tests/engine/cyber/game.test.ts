/**
 * Mode Red/Blue : partie complète sans interface, score, mesure du temps de détection, IA seedée,
 * minuteur et limite de tours.
 */
import { describe, expect, it } from 'vitest'
import {
  aiPrepMoves,
  createGame,
  endGame,
  playGame,
  runMove,
  scoreOf,
  setRedPlan,
  startGame,
  type LabState,
  type Move
} from '@engine/index'
import { redBlueLab } from '../../cyber-lab'

const ALL = ['auth-repetee', 'compte-service', 'reutilisation-acces', 'usurpation-arp', 'saut-de-vlan']
const HARDENING = ['lockout', 'strong-password', 'rotate-service', 'dai', 'nonegotiate']

/** Première graine pour laquelle l'IA Blue ne durcit rien (attaquant face à un lab intact). */
function seedWithoutHardening(lab: LabState): number {
  for (let seed = 1; seed < 200; seed++)
    if (createGame(lab, { side: 'red', seed }).blueQueue.length === 0) return seed
  throw new Error('aucune graine trouvée')
}

describe('IA seedée', () => {
  it('même graine, même choix ; le sous-ensemble respecte le budget et les contre-mesures utiles', () => {
    const lab = redBlueLab()
    const a = createGame(lab, { side: 'red', seed: 7 })
    expect(createGame(lab, { side: 'red', seed: 7 })).toEqual(a)
    for (let seed = 1; seed <= 30; seed++) {
      const g = createGame(lab, { side: 'red', seed })
      expect(g.blueQueue.length).toBeLessThanOrEqual(lab.cyber.game.blueBudget)
      expect(new Set(g.blueQueue).size).toBe(g.blueQueue.length)
      expect(g.blueQueue.every((id) => HARDENING.includes(id))).toBe(true)
    }
    // Les graines produisent bien des sous-ensembles différents
    const queues = new Set(
      Array.from({ length: 30 }, (_, i) => createGame(lab, { side: 'red', seed: i + 1 }).blueQueue.join())
    )
    expect(queues.size).toBeGreaterThan(3)
  })

  it('IA Red : tous les scénarios, dans un ordre dépendant de la graine', () => {
    const lab = redBlueLab()
    const orders = new Set(
      Array.from({ length: 20 }, (_, i) => createGame(lab, { side: 'blue', seed: i + 1 }).redPlan.join())
    )
    expect(orders.size).toBeGreaterThan(3)
    expect([...createGame(lab, { side: 'blue', seed: 3 }).redPlan].sort()).toEqual([...ALL].sort())
  })
})

describe('partie complète : joueur Red contre IA Blue', () => {
  it('face à un lab non durci, les cinq scénarios réussissent ; score Red complet', () => {
    const lab = redBlueLab()
    const seed = seedWithoutHardening(lab)
    const run = playGame(lab, { side: 'red', seed, redPlan: ALL })
    expect(run.game.phase).toBe('over')
    expect(run.game.endReason).toBe('completed')
    expect(run.game.launches.map((l) => l.success)).toEqual([true, true, true, true, true])
    expect(run.score.red).toMatchObject({ attempted: 5, succeeded: 5, interceptedFlows: 1, hoppedHosts: 1 })
    expect(run.score.red.compromisedAccounts.sort()).toEqual(['LAB\\jdupont', 'LAB\\svc-sql'])
    expect(run.score.red.controlledMachines).toEqual(['SRV1'])
    expect(run.score.blue.blocked).toBe(0)
    expect(run.score.outcome).toBe('red')
  })

  it('l’ordre choisi compte : la réutilisation d’accès avant toute compromission échoue', () => {
    const lab = redBlueLab()
    const seed = seedWithoutHardening(lab)
    const run = playGame(lab, {
      side: 'red',
      seed,
      redPlan: ['reutilisation-acces', 'auth-repetee', 'reutilisation-acces']
    })
    // setRedPlan écarte les doublons : deux scénarios joués, le premier échoue faute de compte compromis
    expect(run.game.launches.map((l) => [l.scenarioId, l.success])).toEqual([
      ['reutilisation-acces', false],
      ['auth-repetee', true]
    ])
  })

  it('l’IA Blue durcit en préparation : ses contre-mesures bloquent les scénarios qu’elles visent', () => {
    const lab = redBlueLab()
    const seed = Array.from({ length: 100 }, (_, i) => i + 1).find((s) =>
      createGame(lab, { side: 'red', seed: s }).blueQueue.includes('dai')
    )!
    const game = createGame(lab, { side: 'red', seed })
    const run = playGame(lab, { side: 'red', seed, redPlan: ALL })
    expect(run.game.hardened).toEqual(game.blueQueue)
    const arp = run.game.launches.find((l) => l.scenarioId === 'usurpation-arp')!
    expect(arp.success).toBe(false)
    expect(run.score.blue.blocked).toBeGreaterThan(0)
    expect(run.score.blue.countermeasures).toBe(game.blueQueue.length)
  })
})

describe('partie complète : joueur Blue contre IA Red', () => {
  it('un Blue qui ne fait rien perd ; un Blue qui durcit tout (budget suffisant) bloque les cinq attaques', () => {
    const lab = redBlueLab()
    const idle = playGame(lab, { side: 'blue', seed: 4 })
    // L'ordre de l'IA peut faire échouer la réutilisation d'accès : au moins 4 réussites sur 5
    expect(idle.score.red.succeeded).toBeGreaterThanOrEqual(4)
    expect(idle.score.outcome).toBe('red')

    const rich = structuredClone(lab)
    rich.cyber.game.blueBudget = 5
    const full = playGame(rich, { side: 'blue', seed: 4, bluePrep: HARDENING })
    expect(full.score.blue).toMatchObject({ blocked: 5, countermeasures: 5 })
    expect(full.score.red.succeeded).toBe(0)
    expect(full.score.red.compromisedAccounts).toEqual([])
    expect(full.score.outcome).toBe('blue')
  })

  it('le budget limite les contre-mesures : les suivantes sont refusées sans toucher au lab', () => {
    const lab = redBlueLab()
    const run = playGame(lab, { side: 'blue', seed: 4, bluePrep: HARDENING })
    expect(run.game.hardened).toEqual(HARDENING.slice(0, lab.cyber.game.blueBudget))
  })
})

describe('temps de détection', () => {
  it('mesuré en tours entre le lancement du scénario et le tour où Blue lit l’événement', () => {
    const lab = redBlueLab()
    const analyseAt3: Move[] = [{ kind: 'pass' }, { kind: 'pass' }, { kind: 'analyse' }]
    const run = playGame(lab, { side: 'blue', seed: 5, blueTurns: analyseAt3 })
    // Chaque scénario joué aux tours 1 à 3 est lu au tour 3 ; les suivants ne sont jamais lus
    for (const l of run.game.launches) {
      if (l.events.length === 0) expect(l.detectedTurn).toBeNull()
      else if (l.startTurn <= 3) expect(l.detectedTurn).toBe(3)
      else expect(l.detectedTurn).toBeNull()
    }
    const expected = run.game.launches.filter((l) => l.detectedTurn !== null).map((l) => 3 - l.startTurn)
    expect(run.score.blue.detectionTurns).toEqual(expected)
    const avg = expected.reduce((a, b) => a + b, 0) / expected.length
    expect(run.score.blue.averageDetectionTurns).toBeCloseTo(avg)
    expect(run.score.blue.undetected).toBe(run.score.blue.blocked + run.score.red.succeeded - expected.length)
  })

  it('analyser à chaque tour : détection immédiate (0 tour) de tout événement journalisé', () => {
    const analyseAlways: Move[] = Array.from({ length: 8 }, () => ({ kind: 'analyse' }))
    const run = playGame(redBlueLab(), { side: 'blue', seed: 5, blueTurns: analyseAlways })
    expect(run.score.blue.detectionTurns.every((d) => d === 0)).toBe(true)
    expect(run.score.blue.detected).toBe(run.game.launches.filter((l) => l.events.length > 0).length)
  })

  it('une attaque bloquée est aussi repérée : le switch journalise son refus', () => {
    const lab = redBlueLab()
    lab.cyber.game.blueBudget = 5
    const run = playGame(lab, {
      side: 'blue',
      seed: 5,
      bluePrep: ['dai', 'nonegotiate'],
      blueTurns: Array.from({ length: 8 }, () => ({ kind: 'analyse' }) as Move)
    })
    const arp = run.game.launches.find((l) => l.scenarioId === 'usurpation-arp')!
    expect(arp.success).toBe(false)
    expect(arp.events.some((e) => e.text.includes('SW_DAI'))).toBe(true)
    expect(arp.detectedTurn).toBe(arp.startTurn)
  })

  it('un scénario qui n’émet aucun événement reste invisible', () => {
    const lab = redBlueLab()
    const analyse = Array.from({ length: 8 }, () => ({ kind: 'analyse' }) as Move)
    const run = playGame(lab, { side: 'blue', seed: 5, blueTurns: analyse })
    const silent = run.game.launches.filter((l) => l.events.length === 0)
    expect(silent.every((l) => l.detectedTurn === null)).toBe(true)
  })
})

describe('déroulement et fin de partie', () => {
  it('la partie est déterministe : mêmes options, même résultat', () => {
    const lab = redBlueLab()
    expect(playGame(lab, { side: 'blue', seed: 9 })).toEqual(playGame(lab, { side: 'blue', seed: 9 }))
  })

  it('le nombre de tours est limité par le lab', () => {
    const lab = redBlueLab()
    lab.cyber.game.maxTurns = 2
    const run = playGame(lab, { side: 'red', seed: seedWithoutHardening(lab), redPlan: ALL })
    expect(run.game.endReason).toBe('turns')
    expect(run.game.launches).toHaveLength(2)
  })

  it('le minuteur écoulé termine la partie ; plus aucun coup n’est compté ensuite', () => {
    const lab = redBlueLab()
    let game = setRedPlan(createGame(lab, { side: 'red', seed: 1 }), ALL)
    game = startGame(game)
    const moved = runMove(lab, game, 'red', { kind: 'scenario', id: 'auth-repetee' })
    const over = endGame(moved.game, 'timeout')
    expect(over.endReason).toBe('timeout')
    expect(over.timeline.at(-1)).toMatchObject({ kind: 'end', label: 'timeout' })
    const after = runMove(moved.lab, over, 'red', { kind: 'scenario', id: 'compte-service' })
    expect(after.game.launches).toHaveLength(1)
    expect(scoreOf(over, moved.lab).red.succeeded).toBe(1)
  })

  it('la chronologie rassemble coups, détections et fin, avec les événements journalisés', () => {
    const lab = redBlueLab()
    const run = playGame(lab, { side: 'blue', seed: 2, bluePrep: ['lockout'] })
    const kinds = run.game.timeline.map((e) => e.kind)
    expect(kinds[0]).toBe('harden')
    expect(kinds.at(-1)).toBe('end')
    expect(kinds).toContain('scenario')
    expect(run.game.timeline.find((e) => e.kind === 'scenario')!.events).toBeDefined()
    expect(aiPrepMoves(run.game)).toEqual([])
  })
})
