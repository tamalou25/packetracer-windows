/**
 * Données du rôle DHCP sur un serveur : définition (registre, validation) et accesseur typé.
 */
import { roleState } from '../state'
import type { RoleStateDef } from '../types'
import { DhcpServerSchema, type DhcpServer } from './schema'

/** Serveur DHCP tel qu'après l'installation du rôle. */
export function createDhcpServer(): DhcpServer {
  return {
    authorized: false,
    configured: false,
    scopes: [],
    serverOptions: { router: [], dnsServers: [], dnsDomain: null }
  }
}

export const DHCP_STATE: RoleStateDef<DhcpServer> = {
  key: 'dhcp',
  feature: 'DHCP',
  schema: DhcpServerSchema,
  create: createDhcpServer
}

/** Données DHCP d'un équipement (null si ce n'est pas un serveur DHCP). */
export const dhcpServerOf = (device: Parameters<typeof roleState>[0]): DhcpServer | null =>
  roleState(device, DHCP_STATE)
