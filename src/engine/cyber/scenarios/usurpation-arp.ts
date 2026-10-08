/**
 * Scénario « réseau » 1 : usurpation d'adresse sur le segment.
 *
 * Garde-fou : aucune trame n'est forgée ni émise. Le scénario ne modélise que l'EFFET d'une
 * configuration manquante sur l'état simulé : si l'inspection ARP dynamique ne protège pas le
 * segment (évaluée par le moteur de couche 2 du switch, comme pour tout paquet ARP), le trafic entre
 * deux hôtes est marqué comme intercepté par un troisième ; sinon le switch rejette l'annonce et un
 * message de blocage est inscrit dans son journal (`show logging`). Les hôtes sont désignés par
 * `cyber.arpSpoof` (données du lab).
 */
import { produce } from 'immer'
import { iosL2Inspect } from '../../ios/registry'
import type { Device, LabState } from '../../model/schema'
import { l2Segment, type Hop } from '../../net/segment'
import { switchportOf } from '../../net/switchport'
import { createContext, recordUnicast } from '../../sim/forward'
import { createRecorder, ethernetLayer, type PacketTrace } from '../../sim/trace'
import type { AttackScenario, SimState } from '../scenario'
import { addressedPort, ciscoMac, deviceByName, syslogTime } from './reseau'

interface Hosts {
  attacker: Device
  a: Device
  b: Device
  mac: string
  ipA: string
  ipB: string
  /** Chemin de l'agresseur vers la victime A. */
  path: Hop[]
}

/** Les trois hôtes désignés par le lab, s'ils sont tous sur le même segment de couche 2. */
function hostsOf(state: SimState): Hosts | null {
  const cfg = state.cyber.arpSpoof
  if (!cfg) return null
  const attacker = deviceByName(state, cfg.attacker)
  const a = deviceByName(state, cfg.victimA)
  const b = deviceByName(state, cfg.victimB)
  if (!attacker || !a || !b) return null
  const from = addressedPort(attacker)
  const toA = addressedPort(a)
  const toB = addressedPort(b)
  if (!from || !toA || !toB) return null
  const members = l2Segment(state, { deviceId: attacker.id, ifaceId: from.iface.id })
  const reachesA = members.find((m) => m.port.deviceId === a.id)
  if (!reachesA || !members.some((m) => m.port.deviceId === b.id)) return null
  return { attacker, a, b, mac: from.iface.mac, ipA: toA.address, ipB: toB.address, path: reachesA.path }
}

/** Refus éventuel de l'annonce « ipB est à la MAC de l'agresseur » par un switch du chemin. */
function refusal(state: SimState, h: Hosts) {
  return iosL2Inspect(state, h.path, { kind: 'arp', ip: h.ipB, mac: h.mac, leased: false })
}

/** Port d'arrivée et VLAN de la trame sur le switch qui l'a refusée (pour le message du switch). */
function refusedAt(state: LabState, path: Hop[], index: number): { port: string; vlan: number } {
  const hop = path[index]!
  const port = state.devices[hop.to]?.interfaces.find((i) => i.id === hop.toIfaceId)
  const sp = port ? switchportOf(port) : undefined
  return {
    port: port?.name ?? '?',
    vlan: hop.vlan ?? (sp?.mode === 'access' ? (sp.hoppedVlan ?? sp.accessVlan) : (sp?.nativeVlan ?? 1))
  }
}

export const usurpationArp: AttackScenario = {
  id: 'usurpation-arp',
  name: 'Usurpation d’adresse sur le segment',
  category: 'reseau',
  steps: [
    {
      id: 'annonce-arp',
      label: 'Annonce ARP usurpée sur le segment',
      precondition: (state) => {
        const h = hostsOf(state)
        return !!h && refusal(state, h) === null
      },
      onSuccess: (state) => {
        const h = hostsOf(state)
        if (!h) return state
        return produce(state, (draft) => {
          if (!draft.cyber.intercepts.some((i) => i.a === h.a.id && i.b === h.b.id && i.by === h.attacker.id))
            draft.cyber.intercepts.push({ a: h.a.id, b: h.b.id, by: h.attacker.id })
        })
      },
      // Le switch rejette l'annonce : aucun effet sur l'état des hôtes
      onFailure: (state) => state,
      emits: (success, state) => {
        const h = hostsOf(state)
        if (!h) return []
        if (success)
          // Journal Système de la victime : conflit d'adresse (format de net/config.ts)
          return [
            {
              deviceId: h.a.id,
              level: 'error',
              source: 'Tcpip',
              eventId: 4199,
              message: `Le système a détecté un conflit d’adresse IP pour l’adresse IP ${h.ipB} avec le système dont l’adresse matérielle réseau est ${h.mac}. Les opérations réseau de ce système peuvent être interrompues.`
            }
          ]
        const refused = refusal(state, h)
        if (!refused) return []
        const at = refusedAt(state, h.path, refused.hopIndex)
        return [
          {
            deviceId: refused.deviceId,
            syslog: `%SW_DAI-4-DHCP_SNOOPING_DENY: 1 Invalid ARPs (Res) on ${at.port}, vlan ${at.vlan}.([${ciscoMac(h.mac)}/${h.ipB}/${ciscoMac(h.a.interfaces[0]?.mac ?? '')}/${h.ipA}/${syslogTime(state.clock)}])`
          }
        ]
      },
      trace: (success, state): PacketTrace | null => {
        const h = hostsOf(state)
        if (!h) return null
        const ctx = createContext(state, createRecorder())
        const frame = {
          protocol: 'ARP' as const,
          summary: `ARP : ${h.ipB} est à ${h.mac} (annonce non sollicitée)`,
          layers: [
            ethernetLayer(h.mac, h.a.interfaces[0]?.mac ?? '', 'ARP'),
            {
              layer: 3 as const,
              name: 'ARP',
              fields: [
                ['Opération', '2 (réponse)'],
                ['MAC émetteur', h.mac],
                ['IP émetteur', h.ipB],
                ['IP cible', h.ipA]
              ] as [string, string][]
            }
          ]
        }
        const refused = success ? null : refusal(state, h)
        if (refused)
          recordUnicast(ctx, h.path.slice(0, refused.hopIndex + 1), frame, 'dropped', refused.reason)
        else
          recordUnicast(
            ctx,
            h.path,
            frame,
            'delivered',
            `${h.a.name} met son cache ARP à jour : ${h.ipB} est désormais associée à ${h.mac} (${h.attacker.name}). Son trafic vers ${h.b.name} passe par ${h.attacker.name}.`
          )
        return { title: 'Usurpation ARP (scénario)', events: ctx.rec.events }
      }
    }
  ]
}
