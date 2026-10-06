/**
 * Tutoriel « premier ping » : placer un serveur et un poste, les câbler, leur donner une adresse
 * IP puis réussir un ping. Chaque étape est validée par l'état réel du lab, réévalué à chaque
 * modification (supprimer le serveur fait revenir le tutoriel en arrière). Un ping ne modifiant
 * pas l'état, sa preuve vient des réponses d'écho observées (`echoRepliesDelivered`).
 */
import type { Device, LabState, NetInterface } from '../model/schema'
import { effectiveIpv4, type EffectiveIpv4 } from '../net/addressing'
import type { EchoReceived } from '../net/diagnostics'
import { isApipa, sameSubnet } from '../net/ipv4'
import { l2Segment, linkAt } from '../net/segment'

export const TUTORIAL_STEPS = [
  'place-server',
  'place-client',
  'cable',
  'ip-server',
  'ip-client',
  'ping'
] as const

export type TutorialStepId = (typeof TUTORIAL_STEPS)[number]

/** Serveur ou poste suivi par le tutoriel (repéré par son type : il peut être renommé). */
export interface TutorialHost {
  id: string
  name: string
  /** Adresse IPv4 effective de la carte utilisée (APIPA comprise), ou null. */
  address: string | null
}

export interface TutorialProgress {
  steps: { id: TutorialStepId; done: boolean }[]
  /** Première étape non validée ; null quand le parcours est terminé. */
  current: TutorialStepId | null
  server: TutorialHost | null
  client: TutorialHost | null
}

/** Le poste est-il dans le domaine de diffusion de cette carte du serveur (câble direct ou switchs) ? */
function reaches(state: LabState, server: Device, iface: NetInterface, client: Device): boolean {
  return l2Segment(state, { deviceId: server.id, ifaceId: iface.id }).some(
    (m) => m.port.deviceId === client.id
  )
}

/** Carte du serveur à utiliser : celle qui atteint le poste, sinon une carte câblée, sinon la première. */
function serverPort(state: LabState, server: Device, client: Device | undefined): NetInterface | undefined {
  const l3 = server.interfaces.filter((i) => i.l3)
  return (
    (client && l3.find((i) => reaches(state, server, i, client))) ??
    l3.find((i) => linkAt(state, { deviceId: server.id, ifaceId: i.id })) ??
    l3[0]
  )
}

/** Paire suivie : la première paire serveur / poste reliée, sinon le premier serveur et le premier poste. */
function trackedPair(state: LabState): { server?: Device; client?: Device } {
  const devices = Object.values(state.devices)
  const servers = devices.filter((d) => d.kind === 'server')
  const clients = devices.filter((d) => d.kind === 'client')
  for (const server of servers) {
    for (const client of clients) {
      if (server.interfaces.some((i) => i.l3 && reaches(state, server, i, client))) return { server, client }
    }
  }
  return { server: servers[0], client: clients[0] }
}

function host(device: Device | undefined, eff: EffectiveIpv4 | null): TutorialHost | null {
  return device ? { id: device.id, name: device.name, address: eff?.address ?? null } : null
}

/** Progression du tutoriel sur l'état courant et les réponses d'écho reçues depuis son début. */
export function tutorialProgress(state: LabState, echoes: readonly EchoReceived[]): TutorialProgress {
  const { server, client } = trackedPair(state)
  const sPort = server ? serverPort(state, server, client) : undefined
  const cPort = client?.interfaces.find((i) => i.l3)
  const sEff = sPort ? effectiveIpv4(sPort) : null
  const cEff = cPort ? effectiveIpv4(cPort) : null

  const cabled = !!server && !!client && !!sPort && reaches(state, server, sPort, client)
  // Adresse fixe exigée : deux hôtes en APIPA (169.254.x.x) se joignent déjà sans configuration
  const serverReady = sEff?.source === 'static'
  const clientReady =
    serverReady &&
    !!sEff &&
    !!cEff &&
    !isApipa(cEff.address) &&
    cEff.address !== sEff.address &&
    sameSubnet(cEff.address, sEff.address, sEff.prefixLength) &&
    sameSubnet(cEff.address, sEff.address, cEff.prefixLength)
  const pinged =
    clientReady &&
    !!server &&
    !!client &&
    echoes.some(
      (e) =>
        (e.deviceId === client.id && e.from === sEff?.address) ||
        (e.deviceId === server.id && e.from === cEff?.address)
    )

  const done: Record<TutorialStepId, boolean> = {
    'place-server': !!server,
    'place-client': !!client,
    cable: cabled,
    'ip-server': cabled && serverReady,
    'ip-client': cabled && clientReady,
    ping: cabled && pinged
  }
  const steps = TUTORIAL_STEPS.map((id) => ({ id, done: done[id] }))
  return {
    steps,
    current: steps.find((s) => !s.done)?.id ?? null,
    server: host(server, sEff),
    client: host(client, cEff)
  }
}
