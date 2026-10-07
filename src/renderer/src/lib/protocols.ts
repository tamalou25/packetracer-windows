/**
 * Couleurs associées aux protocoles (enveloppes animées, liste d'événements).
 */
import type { Protocol } from '@engine/index'

export const PROTOCOL_COLORS: Record<Protocol, { fill: string; chip: string }> = {
  ARP: { fill: 'fill-amber-400', chip: 'bg-amber-400' },
  ICMP: { fill: 'fill-fuchsia-500', chip: 'bg-fuchsia-500' },
  DHCP: { fill: 'fill-emerald-500', chip: 'bg-emerald-500' },
  DNS: { fill: 'fill-sky-500', chip: 'bg-sky-500' },
  LDAP: { fill: 'fill-indigo-500', chip: 'bg-indigo-500' },
  KERBEROS: { fill: 'fill-rose-500', chip: 'bg-rose-500' },
  SMB: { fill: 'fill-teal-500', chip: 'bg-teal-500' },
  HTTP: { fill: 'fill-orange-500', chip: 'bg-orange-500' },
  RDP: { fill: 'fill-violet-500', chip: 'bg-violet-500' },
  VPN: { fill: 'fill-lime-600', chip: 'bg-lime-600' }
}

export const OUTCOME_LABELS = {
  forwarded: 'transmis',
  delivered: 'reçu',
  ignored: 'ignoré',
  dropped: 'rejeté'
} as const
