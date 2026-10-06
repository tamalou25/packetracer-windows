/**
 * Autorisation d'un serveur DHCP dans Active Directory.
 * Un serveur membre d'un domaine doit être autorisé pour distribuer des adresses.
 */
import { logEvent } from '../../core/eventlog'
import { raise, transact, type EngineResult } from '../../core/result'
import type { LabState } from '../../model/schema'
import { isDomainAdmin } from '../adds/directory'
import { requireDhcp } from './server'

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

export interface DhcpPostInstallResult {
  /** Autorisation dans AD : effectuée, ignorée à la demande, ou sans objet (groupe de travail). */
  authorization: 'done' | 'skipped' | 'not-member'
}

/**
 * Assistant « Terminer la configuration DHCP » : crée les groupes de sécurité Administrateurs DHCP
 * et Utilisateurs DHCP, puis autorise le serveur dans AD (compte Admins du domaine requis).
 */
export function completeDhcpPostInstall(
  state: LabState,
  deviceId: string,
  options: { authorize: boolean }
): EngineResult<DhcpPostInstallResult> {
  return transact(state, (draft) => {
    const { device, dhcp } = requireDhcp(draft, deviceId)
    let authorization: DhcpPostInstallResult['authorization'] = 'not-member'
    if (device.host.domain) {
      if (options.authorize) {
        const domain = draft.domains[device.host.domain]
        const session = device.host.session
        if (!domain || !session?.domain || !isDomainAdmin(domain, session.user))
          raise(
            'AccessDenied',
            'L’autorisation du serveur DHCP a échoué : accès refusé. Ouvrez une session avec un compte membre des Admins du domaine.'
          )
        dhcp.authorized = true
        logEvent(draft, deviceId, {
          level: 'information',
          source: 'DhcpServer',
          eventId: 1044,
          message: `Le service Serveur DHCP de l’ordinateur local a déterminé qu’il est autorisé à démarrer dans le domaine ${device.host.domain}. Il sert des clients.`
        })
        authorization = 'done'
      } else authorization = 'skipped'
    }
    dhcp.configured = true
    logEvent(draft, deviceId, {
      level: 'information',
      source: 'DhcpServer',
      eventId: 1376,
      message: 'Les groupes de sécurité Administrateurs DHCP et Utilisateurs DHCP ont été créés.'
    })
    return { authorization }
  })
}
