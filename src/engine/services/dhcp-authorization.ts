/**
 * Autorisation d'un serveur DHCP dans Active Directory.
 * Un serveur membre d'un domaine doit être autorisé pour distribuer des adresses.
 */
import { logEvent } from '../core/eventlog'
import { raise, transact, type EngineResult } from '../core/result'
import type { LabState } from '../model/schema'
import { requireDhcp } from './dhcp'

export function authorizeDhcpServer(state: LabState, deviceId: string, authorized: boolean): EngineResult {
  return transact(state, (draft) => {
    const { device, dhcp } = requireDhcp(draft, deviceId)
    if (!device.host.domain)
      raise(
        'NotDomainMember',
        `Impossible d’autoriser le serveur DHCP ${device.name} : cet ordinateur n’est pas membre d’un domaine Active Directory. Un serveur autonome (groupe de travail) n’a pas besoin d’autorisation.`
      )
    dhcp.authorized = authorized
    logEvent(draft, deviceId, {
      level: 'information',
      source: 'DhcpServer',
      eventId: authorized ? 1044 : 1046,
      message: authorized
        ? `Le service Serveur DHCP de l’ordinateur local a déterminé qu’il est autorisé à démarrer dans le domaine ${device.host.domain}. Il sert des clients.`
        : `Le serveur DHCP n’est plus autorisé dans le domaine ${device.host.domain}.`
    })
    return undefined
  })
}
