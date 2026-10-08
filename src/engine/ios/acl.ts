/**
 * Listes d'accès IOS : évaluation d'une liste (première entrée qui correspond, refus implicite
 * final) et lecture des sources « any », « host A » ou « A masque-générique ».
 */
import type { IosAcl as Acl, IosAclEntry as AclEntry } from '../model/schema'
import { wildcardMatch } from './ospf'

/** Paquet évalué par une liste d'accès. */
export interface AclPacket {
  src: string
  dst: string
  protocol: 'icmp' | 'tcp' | 'udp' | 'other'
  dstPort?: number
}

function entryMatches(entry: AclEntry, packet: AclPacket): boolean {
  if (!wildcardMatch(packet.src, entry.src, entry.srcWildcard)) return false
  if (!wildcardMatch(packet.dst, entry.dst, entry.dstWildcard)) return false
  if (entry.protocol !== 'ip' && entry.protocol !== packet.protocol) return false
  if (entry.dstPort !== null && entry.dstPort !== packet.dstPort) return false
  return true
}

/** Entrée qui s'applique au paquet (null : refus implicite « deny any »). */
export function aclMatch(acl: Acl, packet: AclPacket): AclEntry | null {
  return acl.entries.find((e) => entryMatches(e, packet)) ?? null
}

/** Vrai si la liste autorise le paquet. */
export function aclPermits(acl: Acl, packet: AclPacket): boolean {
  return aclMatch(acl, packet)?.action === 'permit'
}

/** Adresse et masque générique d'une désignation IOS (any, host A, A W). */
export function addressSpec(kind: 'any' | 'host' | 'net', address = '', wildcard = ''): [string, string] {
  if (kind === 'any') return ['0.0.0.0', '255.255.255.255']
  if (kind === 'host') return [address, '0.0.0.0']
  return [address, wildcard]
}

/** Désignation IOS d'une adresse et d'un masque générique (any, host A, A W). */
export function formatSpec(address: string, wildcard: string): string {
  if (wildcard === '255.255.255.255') return 'any'
  if (wildcard === '0.0.0.0') return `host ${address}`
  return `${address} ${wildcard}`
}
