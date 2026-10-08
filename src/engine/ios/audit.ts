/**
 * Règles d'audit des switchs Cisco IOS (sécurité de niveau 2) : DHCP snooping, inspection ARP,
 * DTP sur les trunks, VLAN natif, port-security des ports d'accès utilisés.
 */
import type { LabState, NetInterface } from '../model/schema'
import { switchportOf } from '../net/switchport'
import { linkOnInterface } from '../topology/queries'
import type { AuditRule } from '../audit/types'
import { iosState } from './config'
import { isIos, type IosDevice } from './device'
import { dtpActive } from './features/l2sec'

const switches = (state: LabState): IosDevice[] =>
  Object.values(state.devices).filter((d): d is IosDevice => d.kind === 'switch' && isIos(d))

/** Ports physiques du switch. */
const ports = (device: IosDevice): NetInterface[] => device.interfaces.filter((i) => !i.svi && !i.l3)

/** Ports d'accès câblés (un poste ou un serveur y est branché). */
const usedAccessPorts = (state: LabState, device: IosDevice): NetInterface[] =>
  ports(device).filter(
    (p) => p.enabled && switchportOf(p).mode === 'access' && !!linkOnInterface(state, device.id, p.id)
  )

/** VLAN d'accès des ports utilisés. */
const accessVlans = (state: LabState, device: IosDevice): number[] => [
  ...new Set(usedAccessPorts(state, device).map((p) => switchportOf(p).accessVlan))
]

const trunks = (device: IosDevice): NetInterface[] =>
  ports(device).filter((p) => switchportOf(p).mode === 'trunk')

export const IOS_AUDIT_RULES: AuditRule[] = [
  {
    id: 'iosDhcpSnooping',
    title: 'DHCP snooping absent',
    severity: 'moyenne',
    fix: 'Activez « ip dhcp snooping » et « ip dhcp snooping vlan <vlans> », puis déclarez les ports vers les serveurs DHCP légitimes avec « ip dhcp snooping trust ».',
    refs: ['anssi-19', 'cis-12.2'],
    check: (state) =>
      switches(state).flatMap((d) => {
        const ios = iosState(d)
        const missing = accessVlans(state, d).filter(
          (v) => !ios.dhcpSnooping || !ios.dhcpSnoopingVlans.includes(v)
        )
        return missing.length
          ? [
              {
                object: d.name,
                detail: `VLAN d’accès non protégés contre un serveur DHCP non autorisé : ${missing.join(', ')}.`
              }
            ]
          : []
      })
  },
  {
    id: 'iosArpInspection',
    title: 'Inspection ARP dynamique absente',
    severity: 'moyenne',
    fix: 'Activez « ip arp inspection vlan <vlans> » (avec le DHCP snooping) et déclarez les ports vers les routeurs et les autres switchs avec « ip arp inspection trust ».',
    refs: ['anssi-19', 'cis-12.2'],
    check: (state) =>
      switches(state).flatMap((d) => {
        const ios = iosState(d)
        const missing = accessVlans(state, d).filter((v) => !ios.arpInspectionVlans.includes(v))
        return missing.length
          ? [{ object: d.name, detail: `ARP non inspecté sur les VLAN d’accès : ${missing.join(', ')}.` }]
          : []
      })
  },
  {
    id: 'iosDtp',
    title: 'Négociation DTP active sur un trunk',
    severity: 'moyenne',
    fix: 'Sur chaque trunk, ajoutez « switchport nonegotiate » ; laissez les ports vers les postes en « switchport mode access ».',
    refs: ['anssi-19', 'cis-12.2'],
    check: (state) =>
      switches(state).flatMap((d) =>
        trunks(d)
          .filter((p) => dtpActive(d, p))
          .map((p) => ({ object: `${d.name} ${p.name}`, detail: 'Le trunk négocie encore DTP.' }))
      )
  },
  {
    id: 'iosNativeVlan',
    title: 'VLAN natif non dédié',
    severity: 'faible',
    fix: 'Créez un VLAN natif inutilisé (ex. 999) et appliquez « switchport trunk native vlan 999 » à chaque trunk.',
    refs: ['anssi-19', 'cis-12.2'],
    check: (state) =>
      switches(state).flatMap((d) => {
        const used = accessVlans(state, d)
        return trunks(d)
          .filter((p) => {
            const native = switchportOf(p).nativeVlan
            return native === 1 || used.includes(native)
          })
          .map((p) => ({
            object: `${d.name} ${p.name}`,
            detail: `VLAN natif ${switchportOf(p).nativeVlan} : il doit être dédié et n’accueillir aucun port d’accès.`
          }))
      })
  },
  {
    id: 'iosPortSecurity',
    title: 'Ports d’accès sans port-security',
    severity: 'faible',
    fix: 'Sur chaque port d’accès utilisé : « switchport port-security », « switchport port-security maximum 1 », « switchport port-security mac-address sticky ».',
    refs: ['anssi-7', 'cis-13.9'],
    check: (state) =>
      switches(state).flatMap((d) => {
        const open = usedAccessPorts(state, d).filter(
          (p) => !iosState(d).interfaces[p.name]?.portSecurity?.enabled
        )
        return open.length
          ? [{ object: d.name, detail: `Ports sans port-security : ${open.map((p) => p.name).join(', ')}.` }]
          : []
      })
  }
]
