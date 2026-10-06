/**
 * Tutoriel « premier ping » : chaque étape est validée par l'état réel du lab (pas par un bouton
 * Suivant) ; le ping, qui ne modifie pas l'état, est prouvé par les réponses d'écho observées.
 */
import { describe, expect, it } from 'vitest'
import {
  createShellSession,
  echoRepliesDelivered,
  executeLine,
  ping,
  removeDevices,
  renameDevice,
  setPower,
  tutorialProgress,
  unwrap,
  type EchoReceived,
  type LabState
} from '@engine/index'
import { add, build, cable, createLab, setIp } from '../helpers'

const current = (s: LabState, echoes: EchoReceived[] = []) => tutorialProgress(s, echoes).current

/** Ping exécuté directement par le moteur (comme l'outil PDU). */
function pingNow(s: LabState, from: string, target: string, count = 1) {
  const r = ping(s, from, target, { count })
  if (!r.ok) throw new Error(r.error.message)
  return r.value
}

/** Écho reçu après un ping exécuté depuis la console de `from` (comme dans l'application). */
function consolePing(s: LabState, from: string, target: string): EchoReceived[] {
  const result = executeLine(s, createShellSession(s, from, 'cmd'), `ping ${target}`, [])
  expect(result.state).toBe(s) // le ping ne laisse aucune trace dans l'état
  return echoRepliesDelivered(result.trace)
}

/** Serveur et poste câblés, adressés dans 192.168.1.0/24. */
function readyPair(): { state: LabState; srv: string; pc: string } {
  const { state, ids } = build([
    ['server', 'SRV1'],
    ['client', 'PC1']
  ])
  let s = cable(state, ids.SRV1!, 0, ids.PC1!, 0)
  s = setIp(s, ids.SRV1!, 0, '192.168.1.1/24')
  s = setIp(s, ids.PC1!, 0, '192.168.1.10/24')
  return { state: s, srv: ids.SRV1!, pc: ids.PC1! }
}

describe('réponses d’écho dans une trace', () => {
  it('un ping réussi : une réponse remise à la source, depuis l’adresse visée', () => {
    const { state, srv, pc } = readyPair()
    const r = pingNow(state, pc, '192.168.1.1', 2)
    expect(echoRepliesDelivered(r.trace)).toEqual([
      { deviceId: pc, from: '192.168.1.1' },
      { deviceId: pc, from: '192.168.1.1' }
    ])
    expect(echoRepliesDelivered(null)).toEqual([])
    // Cible absente : demandes sans réponse
    expect(echoRepliesDelivered(pingNow(state, srv, '192.168.1.99').trace)).toEqual([])
  })
})

describe('tutoriel « premier ping »', () => {
  it('progression pas à pas, validée par l’état du lab', () => {
    let s = createLab()
    expect(current(s)).toBe('place-server')
    const srv = add(s, 'server')
    s = srv.state
    expect(current(s)).toBe('place-client')
    const pc = add(s, 'client')
    s = pc.state
    expect(current(s)).toBe('cable')
    s = cable(s, srv.id, 0, pc.id, 0)
    expect(current(s)).toBe('ip-server')
    s = setIp(s, srv.id, 0, '10.0.0.1/8')
    expect(current(s)).toBe('ip-client')
    s = setIp(s, pc.id, 0, '10.0.0.2/8')
    expect(current(s)).toBe('ping')
    const progress = tutorialProgress(s, consolePing(s, pc.id, '10.0.0.1'))
    expect(progress.current).toBeNull()
    expect(progress.steps.every((step) => step.done)).toBe(true)
    expect(progress.server).toEqual({ id: srv.id, name: 'SRV1', address: '10.0.0.1' })
    expect(progress.client).toEqual({ id: pc.id, name: 'PC1', address: '10.0.0.2' })
  })

  it('câble à travers un switch', () => {
    const { state, ids } = build([
      ['server', 'SRV1'],
      ['client', 'PC1'],
      ['switch', 'SW1']
    ])
    let s = cable(state, ids.SRV1!, 0, ids.SW1!, 0)
    expect(current(s)).toBe('cable')
    s = cable(s, ids.PC1!, 0, ids.SW1!, 1)
    expect(current(s)).toBe('ip-server')
  })

  it('adresses automatiques (APIPA) refusées, même si les hôtes se joignent déjà', () => {
    const { state, ids } = build([
      ['server', 'SRV1'],
      ['client', 'PC1']
    ])
    const s = cable(state, ids.SRV1!, 0, ids.PC1!, 0)
    const apipa = tutorialProgress(s, []).server?.address ?? ''
    expect(apipa).toMatch(/^169\.254\./)
    const echoes = consolePing(s, ids.PC1!, apipa)
    expect(echoes).toHaveLength(4)
    expect(current(s, echoes)).toBe('ip-server')
  })

  it('poste hors du réseau du serveur, ou avec la même adresse : refusé', () => {
    const { state, srv, pc } = readyPair()
    expect(current(setIp(state, pc, 0, '192.168.2.10/24'))).toBe('ip-client')
    expect(current(setIp(state, pc, 0, '192.168.1.1/24'))).toBe('ip-client')
    // Masques différents : le poste ne se croit pas dans le même réseau
    expect(current(setIp(state, pc, 0, '192.168.1.10/30'))).toBe('ip-client')
    expect(current(setIp(state, srv, 0, '192.168.1.1/24'))).toBe('ping')
  })

  it('ping possible mais pas effectué : étape non validée', () => {
    const { state, pc } = readyPair()
    expect(pingNow(state, pc, '192.168.1.1').success).toBe(true)
    expect(current(state, [])).toBe('ping')
  })

  it('ping dans un sens ou dans l’autre ; écho venu d’une autre adresse refusé', () => {
    const { state, srv, pc } = readyPair()
    expect(current(state, consolePing(state, srv, '192.168.1.10'))).toBeNull()
    expect(current(state, [{ deviceId: pc, from: '192.168.1.200' }])).toBe('ping')
    // Écho reçu avant la configuration (APIPA) : ne vaut plus après
    expect(current(state, [{ deviceId: pc, from: '169.254.1.3' }])).toBe('ping')
  })

  it('retour en arrière : serveur supprimé ou éteint', () => {
    const { state, srv, pc } = readyPair()
    const echoes = consolePing(state, pc, '192.168.1.1')
    expect(current(state, echoes)).toBeNull()
    expect(current(unwrap(setPower(state, srv, false)).state, echoes)).toBe('cable')
    expect(current(unwrap(removeDevices(state, [srv])).state, echoes)).toBe('place-server')
  })

  it('appareils renommés : suivis par leur type', () => {
    const { state, srv, pc } = readyPair()
    const s = unwrap(renameDevice(state, srv, 'DC-PARIS')).state
    const progress = tutorialProgress(s, consolePing(s, pc, '192.168.1.1'))
    expect(progress.current).toBeNull()
    expect(progress.server?.name).toBe('DC-PARIS')
  })

  it('plusieurs serveurs : la paire suivie est celle qui est reliée', () => {
    const { state, ids } = build([
      ['server', 'SRV1'],
      ['server', 'SRV2'],
      ['client', 'PC1']
    ])
    const s = cable(state, ids.SRV2!, 0, ids.PC1!, 0)
    const progress = tutorialProgress(s, [])
    expect(progress.current).toBe('ip-server')
    expect(progress.server?.name).toBe('SRV2')
  })
})
