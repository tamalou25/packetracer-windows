/**
 * Données du rôle DNS sur un serveur : définition (registre, validation) et accesseur typé.
 */
import { roleState } from '../state'
import type { RoleStateDef } from '../types'
import { DnsServerSchema, type DnsServer } from './schema'

/** Serveur DNS tel qu'après l'installation du rôle. */
export function createDnsServer(): DnsServer {
  return { zones: [], forwarders: [], useRootHints: true }
}

export const DNS_STATE: RoleStateDef<DnsServer> = {
  key: 'dns',
  feature: 'DNS',
  schema: DnsServerSchema,
  create: createDnsServer
}

/** Données DNS d'un équipement (null si ce n'est pas un serveur DNS). */
export const dnsServerOf = (device: Parameters<typeof roleState>[0]): DnsServer | null =>
  roleState(device, DNS_STATE)
