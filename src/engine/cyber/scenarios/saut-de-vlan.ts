/**
 * Scénario « réseau » 2 : changement de VLAN non autorisé.
 *
 * Garde-fou : aucune trame 802.1Q ni DTP n'est forgée ou émise. Le scénario ne modélise que
 * l'EFFET d'une configuration manquante sur l'état simulé : si le port de l'hôte a gardé la
 * négociation de trunk (pas de `switchport nonegotiate`) et n'a pas de VLAN natif dédié (VLAN 1 par
 * défaut), l'hôte passe dans le VLAN visé sans que la configuration du port change (état
 * `hoppedVlan`) ; sinon le port refuse et un message de blocage est inscrit dans le journal du
 * switch (`show logging`). L'hôte et le VLAN visé sont désignés par `cyber.vlanHop`.
 */
import { produce } from 'immer'
import { iosState } from '../../ios/config'
import { isIos } from '../../ios/device'
import type { Device, NetInterface } from '../../model/schema'
import type { Hop } from '../../net/segment'
import { switchportOf } from '../../net/switchport'
import { createContext, recordUnicast } from '../../sim/forward'
import { createRecorder, type PacketTrace } from '../../sim/trace'
import type { AttackScenario, SimState } from '../scenario'
import { deviceByName, hostPortOf } from './reseau'

type Verdict = 'vulnerable' | 'protege' | 'sans-objet'

interface Target {
  attacker: Device
  sw: Device
  port: NetInterface
  toVlan: number
  hop: Hop
  verdict: Verdict
}

/** Port du switch où l'hôte est branché, et verdict selon la configuration de ce port. */
function targetOf(state: SimState): Target | null {
  const cfg = state.cyber.vlanHop
  const attacker = cfg && deviceByName(state, cfg.attacker)
  if (!cfg || !attacker) return null
  const located = hostPortOf(state, attacker)
  if (!located) return null
  const { card, link, sw, port } = located
  const config = switchportOf(port)
  const hop: Hop = {
    linkId: link.id,
    from: attacker.id,
    fromIfaceId: card.id,
    to: sw.id,
    toIfaceId: port.id
  }
  const base = { attacker, sw, port, toVlan: cfg.toVlan, hop }
  // Un VLAN inexistant, le VLAN courant ou un port déjà en trunk : rien à faire
  const current = config.hoppedVlan ?? config.accessVlan
  if (config.mode !== 'access' || cfg.toVlan === current || !sw.vlans.some((v) => v.id === cfg.toVlan))
    return { ...base, verdict: 'sans-objet' }
  const negotiationOff = isIos(sw) && !!iosState(sw).interfaces[port.name]?.nonegotiate
  const nativeDedicated = config.nativeVlan !== 1
  return { ...base, verdict: negotiationOff || nativeDedicated ? 'protege' : 'vulnerable' }
}

export const sautDeVlan: AttackScenario = {
  id: 'saut-de-vlan',
  name: 'Changement de VLAN non autorisé',
  category: 'reseau',
  steps: [
    {
      id: 'negociation-trunk',
      label: 'Demande de négociation de trunk',
      precondition: (state) => targetOf(state)?.verdict === 'vulnerable',
      onSuccess: (state) => {
        const t = targetOf(state)
        if (!t) return state
        return produce(state, (draft) => {
          const port = draft.devices[t.sw.id]?.interfaces.find((i) => i.id === t.port.id)
          if (port) port.switchport = { ...switchportOf(t.port), hoppedVlan: t.toVlan }
        })
      },
      // Le port refuse : la configuration et l'état du port ne changent pas
      onFailure: (state) => state,
      emits: (success, state) => {
        const t = targetOf(state)
        if (!t || t.verdict === 'sans-objet') return []
        return [
          {
            deviceId: t.sw.id,
            syslog: success
              ? `%DTP-5-TRUNKPORTON: Port ${t.port.name} has become dot1q trunk`
              : `%L2SEC-4-VLAN_CHANGE_DENIED: Port ${t.port.name} refused the VLAN ${t.toVlan} change request (trunk negotiation disabled or dedicated native VLAN)`
          }
        ]
      },
      trace: (success, state): PacketTrace | null => {
        const t = targetOf(state)
        if (!t || t.verdict === 'sans-objet') return null
        const ctx = createContext(state, createRecorder())
        recordUnicast(
          ctx,
          [t.hop],
          {
            protocol: 'DTP',
            summary: `DTP : demande de passage en trunk, VLAN visé ${t.toVlan}`,
            layers: [
              {
                layer: 2,
                name: 'DTP',
                fields: [
                  ['MAC source', t.attacker.interfaces[0]?.mac ?? ''],
                  ['MAC destination', '01-00-0C-CC-CC-CC'],
                  ['Demande', 'trunk (desirable)'],
                  ['VLAN visé', String(t.toVlan)]
                ]
              }
            ]
          },
          success ? 'delivered' : 'dropped',
          success
            ? `${t.sw.name} accepte la négociation sur ${t.port.name} (pas de switchport nonegotiate, VLAN natif non dédié) : ${t.attacker.name} passe dans le VLAN ${t.toVlan} sans reconfiguration du port.`
            : `${t.sw.name} refuse la demande sur ${t.port.name} : négociation de trunk désactivée ou VLAN natif dédié.`
        )
        return { title: 'Changement de VLAN (scénario)', events: ctx.rec.events }
      }
    }
  ]
}
