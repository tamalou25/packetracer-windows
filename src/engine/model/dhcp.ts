/**
 * Données d'un serveur DHCP : rôle Serveur DHCP d'un serveur (`device.roles.dhcp`) et serveur
 * DHCP IOS d'un routeur ou d'un switch Cisco (`device.ios.dhcpServer`, une étendue par pool).
 */
import { z } from 'zod'

/** Options DHCP (003 routeur, 006 serveurs DNS, 015 nom de domaine DNS). */
export const DhcpOptionsSchema = z.object({
  router: z.array(z.string()).default([]),
  dnsServers: z.array(z.string()).default([]),
  dnsDomain: z.string().nullable().default(null)
})

export const DhcpExclusionSchema = z.object({ start: z.string(), end: z.string() })

export const DhcpReservationSchema = z.object({
  ip: z.string(),
  /** Adresse MAC normalisée (XX-XX-XX-XX-XX-XX). */
  mac: z.string(),
  name: z.string(),
  description: z.string().default('')
})

export const DhcpLeaseSchema = z.object({
  ip: z.string(),
  mac: z.string(),
  hostName: z.string(),
  expiresAt: z.number(),
  /** BadAddress : adresse refusée car déjà utilisée sur le réseau. */
  state: z.enum(['Active', 'BadAddress']).default('Active')
})

export const DhcpScopeSchema = z.object({
  /** Adresse du réseau (identifiant de l'étendue). */
  scopeId: z.string(),
  name: z.string(),
  description: z.string().default(''),
  start: z.string(),
  end: z.string(),
  prefixLength: z.number().int().min(1).max(30),
  state: z.enum(['Active', 'Inactive']).default('Active'),
  leaseDurationSec: z
    .number()
    .int()
    .positive()
    .default(8 * 24 * 3600),
  exclusions: z.array(DhcpExclusionSchema).default([]),
  reservations: z.array(DhcpReservationSchema).default([]),
  leases: z.array(DhcpLeaseSchema).default([]),
  options: DhcpOptionsSchema.default({ router: [], dnsServers: [], dnsDomain: null })
})

export const DhcpServerSchema = z.object({
  /** Autorisé dans Active Directory (obligatoire pour un serveur membre d'un domaine). */
  authorized: z.boolean().default(false),
  /** Configuration post-installation terminée (groupes de sécurité créés, notification levée). */
  configured: z.boolean().default(false),
  scopes: z.array(DhcpScopeSchema).default([]),
  serverOptions: DhcpOptionsSchema.default({ router: [], dnsServers: [], dnsDomain: null })
})

export type DhcpOptions = z.infer<typeof DhcpOptionsSchema>
export type DhcpScope = z.infer<typeof DhcpScopeSchema>
export type DhcpServer = z.infer<typeof DhcpServerSchema>
export type DhcpReservation = z.infer<typeof DhcpReservationSchema>
export type DhcpLease = z.infer<typeof DhcpLeaseSchema>
