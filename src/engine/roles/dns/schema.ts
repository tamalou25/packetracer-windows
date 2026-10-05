/**
 * Données du rôle Serveur DNS (stockées dans `device.roles.dns`).
 */
import { z } from 'zod'

export const DNS_RECORD_TYPES = ['A', 'PTR', 'CNAME', 'NS', 'SOA', 'SRV'] as const

export const DnsRecordSchema = z.object({
  /** Nom relatif à la zone (« @ » pour la racine de la zone). */
  name: z.string(),
  type: z.enum(DNS_RECORD_TYPES),
  /** Données : adresse IPv4 (A), nom complet (CNAME, PTR, NS), « priorité poids port cible » (SRV)… */
  data: z.string(),
  ttl: z.number().int().positive().default(3600),
  /** Inscrit dynamiquement par un client (mise à jour dynamique). */
  dynamic: z.boolean().default(false)
})

export const DnsZoneSchema = z.object({
  /** Nom complet en minuscules (lab.local, 1.168.192.in-addr.arpa). */
  name: z.string(),
  reverse: z.boolean(),
  /** Zone intégrée à Active Directory (stockée dans l'annuaire). */
  adIntegrated: z.boolean().default(false),
  dynamicUpdate: z.enum(['None', 'Secure', 'NonsecureAndSecure']).default('None'),
  records: z.array(DnsRecordSchema).default([])
})

export const DnsServerSchema = z.object({
  zones: z.array(DnsZoneSchema).default([]),
  forwarders: z.array(z.string()).default([]),
  /** Utiliser les indications de racine si aucun redirecteur ne répond. */
  useRootHints: z.boolean().default(true)
})

export type DnsRecord = z.infer<typeof DnsRecordSchema>
export type DnsRecordType = DnsRecord['type']
export type DnsZone = z.infer<typeof DnsZoneSchema>
export type DnsServer = z.infer<typeof DnsServerSchema>
