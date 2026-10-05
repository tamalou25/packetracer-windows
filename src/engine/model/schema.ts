/**
 * Modèle de données du moteur, défini une seule fois sous forme de schémas zod.
 * Les types TypeScript sont inférés de ces schémas : le format des fichiers .slab
 * et le typage du code ne peuvent donc pas diverger.
 *
 * Règle : tout nouveau champ ajouté au modèle doit avoir une valeur par défaut
 * (`.default(...)`) pour rester compatible avec les fichiers existants.
 */
import { z } from 'zod'
import { DEVICE_KINDS } from './kinds'

/** Position d'un équipement sur le canvas (simple donnée, sans dépendance UI). */
export const PositionSchema = z.object({ x: z.number(), y: z.number() })

/** Bail DHCP obtenu par une carte réseau cliente. */
export const DhcpClientLeaseSchema = z.object({
  address: z.string(),
  prefixLength: z.number().int().min(0).max(32),
  gateway: z.string().nullable().default(null),
  dnsServers: z.array(z.string()).default([]),
  dnsSuffix: z.string().nullable().default(null),
  serverId: z.string(),
  serverDeviceId: z.string(),
  obtainedAt: z.number(),
  expiresAt: z.number()
})

/** Carte réseau / port d'un équipement. */
export const NetInterfaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  mac: z.string(),
  enabled: z.boolean().default(true),
  /** false pour les ports de switch (niveau 2 uniquement). */
  l3: z.boolean(),
  /** Mode d'adressage IPv4 (statique ou DHCP). */
  addressing: z.enum(['static', 'dhcp']).default('static'),
  address: z.string().nullable().default(null),
  prefixLength: z.number().int().min(0).max(32).nullable().default(null),
  gateway: z.string().nullable().default(null),
  /** DNS : saisis manuellement ou obtenus par DHCP. */
  dnsMode: z.enum(['static', 'dhcp']).default('static'),
  dnsServers: z.array(z.string()).default([]),
  dhcpLease: DhcpClientLeaseSchema.nullable().default(null)
})

/** Entrée du journal d'événements (Observateur d'événements simplifié). */
export const EventLogEntrySchema = z.object({
  id: z.number().int(),
  time: z.number(),
  level: z.enum(['information', 'warning', 'error']),
  log: z.enum(['Système', 'Application', 'Sécurité', 'Service d’annuaire', 'Serveur DNS']).default('Système'),
  source: z.string(),
  eventId: z.number().int(),
  message: z.string()
})

/** Route statique d'un routeur. */
export const StaticRouteSchema = z.object({
  network: z.string(),
  prefixLength: z.number().int().min(0).max(32),
  nextHop: z.string()
})

/** Partie « système d'exploitation » commune aux serveurs et postes clients. */
export const HostSchema = z.object({
  workgroup: z.string().default('WORKGROUP'),
  /** Domaine AD rejoint (FQDN) ou null si groupe de travail. */
  domain: z.string().nullable().default(null),
  /** Rôles et fonctionnalités installés (noms techniques : DHCP, DNS, AD-Domain-Services…). */
  features: z.array(z.string()).default([]),
  pendingReboot: z.boolean().default(false),
  eventLog: z.array(EventLogEntrySchema).default([])
})

const deviceBase = {
  id: z.string(),
  name: z.string(),
  position: PositionSchema,
  powered: z.boolean().default(true),
  interfaces: z.array(NetInterfaceSchema)
}

export const ServerDeviceSchema = z.object({ ...deviceBase, kind: z.literal('server'), host: HostSchema })
export const ClientDeviceSchema = z.object({ ...deviceBase, kind: z.literal('client'), host: HostSchema })
export const SwitchDeviceSchema = z.object({ ...deviceBase, kind: z.literal('switch') })
export const RouterDeviceSchema = z.object({
  ...deviceBase,
  kind: z.literal('router'),
  routes: z.array(StaticRouteSchema).default([])
})
export const CloudDeviceSchema = z.object({ ...deviceBase, kind: z.literal('cloud') })

export const DeviceSchema = z.discriminatedUnion('kind', [
  ServerDeviceSchema,
  ClientDeviceSchema,
  SwitchDeviceSchema,
  RouterDeviceSchema,
  CloudDeviceSchema
])

/** Extrémité d'un câble : un port précis d'un équipement. */
export const LinkEndSchema = z.object({ deviceId: z.string(), ifaceId: z.string() })

export const LinkSchema = z.object({
  id: z.string(),
  a: LinkEndSchema,
  b: LinkEndSchema
})

/** État complet d'un lab : source de vérité unique de l'application. */
export const LabStateSchema = z.object({
  devices: z.record(z.string(), DeviceSchema),
  links: z.record(z.string(), LinkSchema),
  /** Compteur servant à générer identifiants et adresses MAC de façon déterministe. */
  seq: z.number().int().nonnegative(),
  /** Horloge simulée (millisecondes). */
  clock: z.number().nonnegative().default(0)
})

export const DeviceKindSchema = z.enum(DEVICE_KINDS)

export type Position = z.infer<typeof PositionSchema>
export type DhcpClientLease = z.infer<typeof DhcpClientLeaseSchema>
export type NetInterface = z.infer<typeof NetInterfaceSchema>
export type EventLogEntry = z.infer<typeof EventLogEntrySchema>
export type StaticRoute = z.infer<typeof StaticRouteSchema>
export type Host = z.infer<typeof HostSchema>
export type ServerDevice = z.infer<typeof ServerDeviceSchema>
export type ClientDevice = z.infer<typeof ClientDeviceSchema>
export type SwitchDevice = z.infer<typeof SwitchDeviceSchema>
export type RouterDevice = z.infer<typeof RouterDeviceSchema>
export type CloudDevice = z.infer<typeof CloudDeviceSchema>
export type Device = z.infer<typeof DeviceSchema>
export type HostDevice = ServerDevice | ClientDevice
export type LinkEnd = z.infer<typeof LinkEndSchema>
export type Link = z.infer<typeof LinkSchema>
export type LabState = z.infer<typeof LabStateSchema>
