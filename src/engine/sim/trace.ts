/**
 * Trace de paquets : suite d'événements « PDU » rejouable pas à pas en mode Simulation.
 */

export type Protocol = 'ARP' | 'ICMP' | 'DHCP' | 'DNS' | 'LDAP' | 'KERBEROS' | 'SMB' | 'HTTP' | 'RDP'

export const PROTOCOLS: Protocol[] = ['ARP', 'ICMP', 'DHCP', 'DNS', 'LDAP', 'KERBEROS', 'SMB', 'HTTP', 'RDP']

/** Une couche du modèle OSI avec ses champs principaux. */
export interface PduLayer {
  layer: 2 | 3 | 4 | 7
  name: string
  fields: [string, string][]
}

/** Devenir de la trame à son arrivée sur l'équipement. */
export type PduOutcome = 'forwarded' | 'delivered' | 'ignored' | 'dropped'

/** Une trame traversant un câble. */
export interface PduEvent {
  /** Pas logique : les événements d'un même pas sont simultanés. */
  step: number
  protocol: Protocol
  linkId: string
  fromDeviceId: string
  toDeviceId: string
  summary: string
  layers: PduLayer[]
  outcome: PduOutcome
  /** Explication pédagogique de ce qui se passe à l'arrivée. */
  note: string
}

export interface PacketTrace {
  title: string
  events: PduEvent[]
}

/** Contexte d'une simulation en cours (mutable le temps du calcul). */
export interface TraceRecorder {
  events: PduEvent[]
  step: number
}

export function createRecorder(): TraceRecorder {
  return { events: [], step: 0 }
}

export function ethernetLayer(srcMac: string, dstMac: string, type: 'IPv4' | 'ARP'): PduLayer {
  return {
    layer: 2,
    name: 'Ethernet II',
    fields: [
      ['MAC source', srcMac],
      ['MAC destination', dstMac],
      ['Type', type === 'ARP' ? '0x0806 (ARP)' : '0x0800 (IPv4)']
    ]
  }
}

export function ipv4Layer(src: string, dst: string, ttl: number, protocol: string): PduLayer {
  return {
    layer: 3,
    name: 'IPv4',
    fields: [
      ['IP source', src],
      ['IP destination', dst],
      ['TTL', String(ttl)],
      ['Protocole', protocol]
    ]
  }
}

export const BROADCAST_MAC = 'FF-FF-FF-FF-FF-FF'

/**
 * Couches d'une trame sur un câble : l'étiquette 802.1Q (VLAN) est insérée après l'en-tête
 * Ethernet quand la trame circule étiquetée (trunk, sous-interface de routeur).
 */
export function taggedLayers(layers: PduLayer[], vlan: number | undefined): PduLayer[] {
  if (vlan === undefined) return layers
  const at = layers.findIndex((l) => l.layer === 2) + 1
  const tag: PduLayer = {
    layer: 2,
    name: '802.1Q',
    fields: [
      ['TPID', '0x8100'],
      ['Priorité', '0'],
      ['VLAN', String(vlan)]
    ]
  }
  return [...layers.slice(0, at), tag, ...layers.slice(at)]
}

/** Concatène plusieurs traces en décalant les pas (opérations successives). */
export function concatTraces(title: string, traces: PacketTrace[]): PacketTrace {
  const events: PduEvent[] = []
  let offset = 0
  for (const t of traces) {
    let max = 0
    for (const e of t.events) {
      events.push({ ...e, step: e.step + offset })
      max = Math.max(max, e.step)
    }
    offset += max
  }
  return { title, events }
}
