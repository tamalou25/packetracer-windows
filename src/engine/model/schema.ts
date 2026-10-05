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
  dhcpLease: DhcpClientLeaseSchema.nullable().default(null),
  /** Bail libéré manuellement (ipconfig /release) : plus d'adresse jusqu'au prochain renouvellement. */
  dhcpReleased: z.boolean().default(false)
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

/** Utilisateur connecté (session interactive). `domain` null = compte local. */
export const HostSessionSchema = z.object({
  user: z.string(),
  domain: z.string().nullable().default(null)
})

/** Partie « système d'exploitation » commune aux serveurs et postes clients. */
export const HostSchema = z.object({
  workgroup: z.string().default('WORKGROUP'),
  /** Domaine AD rejoint (FQDN) ou null si groupe de travail. */
  domain: z.string().nullable().default(null),
  /** Rôles et fonctionnalités installés (noms techniques : DHCP, DNS, AD-Domain-Services…). */
  features: z.array(z.string()).default([]),
  pendingReboot: z.boolean().default(false),
  /** Nouveau nom appliqué au prochain redémarrage (Rename-Computer). */
  pendingName: z.string().nullable().default(null),
  /** Domaine rejoint, effectif au prochain redémarrage (Add-Computer) ; '' = retour en groupe de travail. */
  pendingDomain: z.string().nullable().default(null),
  /** Mot de passe du compte Administrateur local. */
  localAdminPassword: z.string().default('P@ssw0rd'),
  /** Session ouverte (null = écran de connexion). */
  session: HostSessionSchema.nullable().default(null),
  /** Horloge du lab au dernier démarrage (redémarrage, mise sous tension). */
  bootedAt: z.number().default(0),
  eventLog: z.array(EventLogEntrySchema).default([])
})

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

/** Données des rôles serveur. */
export const ServerServicesSchema = z.object({
  dhcp: DhcpServerSchema.nullable().default(null),
  dns: DnsServerSchema.nullable().default(null)
})

const deviceBase = {
  id: z.string(),
  name: z.string(),
  position: PositionSchema,
  powered: z.boolean().default(true),
  interfaces: z.array(NetInterfaceSchema)
}

export const ServerDeviceSchema = z.object({
  ...deviceBase,
  kind: z.literal('server'),
  host: HostSchema,
  services: ServerServicesSchema.default({ dhcp: null, dns: null })
})
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

// ---------------------------------------------------------------------------
// Active Directory
// ---------------------------------------------------------------------------

/** Unité d'organisation ou conteneur (CN=Users, CN=Computers…). */
export const AdContainerSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Conteneur parent (null = racine du domaine). */
  parentId: z.string().nullable(),
  kind: z.enum(['ou', 'container']),
  description: z.string().default(''),
  /** Protéger contre la suppression accidentelle. */
  protected: z.boolean().default(false),
  builtin: z.boolean().default(false)
})

export const AdUserSchema = z.object({
  id: z.string(),
  /** Nom d'ouverture de session (pré-Windows 2000). */
  sam: z.string(),
  /** Nom complet (CN). */
  name: z.string(),
  givenName: z.string().default(''),
  surname: z.string().default(''),
  upn: z.string().default(''),
  parentId: z.string(),
  password: z.string().default(''),
  enabled: z.boolean().default(true),
  mustChangePassword: z.boolean().default(false),
  description: z.string().default(''),
  builtin: z.boolean().default(false)
})

export const AdGroupSchema = z.object({
  id: z.string(),
  sam: z.string(),
  name: z.string(),
  parentId: z.string(),
  scope: z.enum(['DomainLocal', 'Global', 'Universal']),
  category: z.enum(['Security', 'Distribution']).default('Security'),
  /** Identifiants des membres (utilisateurs, groupes, ordinateurs). */
  members: z.array(z.string()).default([]),
  description: z.string().default(''),
  builtin: z.boolean().default(false)
})

export const AdComputerSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string(),
  /** Équipement du lab correspondant (null si l'ordinateur n'existe plus). */
  deviceId: z.string().nullable(),
  enabled: z.boolean().default(true),
  dnsHostName: z.string().default('')
})

export const DomainSchema = z.object({
  /** Nom DNS du domaine (lab.local). */
  name: z.string(),
  /** Nom NetBIOS (LAB). */
  netbios: z.string(),
  /** Contrôleurs de domaine (identifiants d'équipements). */
  controllers: z.array(z.string()).default([]),
  containers: z.array(AdContainerSchema).default([]),
  users: z.array(AdUserSchema).default([]),
  groups: z.array(AdGroupSchema).default([]),
  computers: z.array(AdComputerSchema).default([])
})

/** État complet d'un lab : source de vérité unique de l'application. */
export const LabStateSchema = z.object({
  devices: z.record(z.string(), DeviceSchema),
  links: z.record(z.string(), LinkSchema),
  /** Compteur servant à générer identifiants et adresses MAC de façon déterministe. */
  seq: z.number().int().nonnegative(),
  /** Horloge simulée (millisecondes). */
  clock: z.number().nonnegative().default(0),
  /** Domaines Active Directory (clé : nom DNS du domaine). */
  domains: z.record(z.string(), DomainSchema).default({})
})

export const DeviceKindSchema = z.enum(DEVICE_KINDS)

export type Position = z.infer<typeof PositionSchema>
export type DhcpClientLease = z.infer<typeof DhcpClientLeaseSchema>
export type NetInterface = z.infer<typeof NetInterfaceSchema>
export type EventLogEntry = z.infer<typeof EventLogEntrySchema>
export type StaticRoute = z.infer<typeof StaticRouteSchema>
export type Host = z.infer<typeof HostSchema>
export type HostSession = z.infer<typeof HostSessionSchema>
export type ServerDevice = z.infer<typeof ServerDeviceSchema>
export type ClientDevice = z.infer<typeof ClientDeviceSchema>
export type SwitchDevice = z.infer<typeof SwitchDeviceSchema>
export type RouterDevice = z.infer<typeof RouterDeviceSchema>
export type CloudDevice = z.infer<typeof CloudDeviceSchema>
export type Device = z.infer<typeof DeviceSchema>
export type DhcpOptions = z.infer<typeof DhcpOptionsSchema>
export type DhcpScope = z.infer<typeof DhcpScopeSchema>
export type DhcpServer = z.infer<typeof DhcpServerSchema>
export type DhcpReservation = z.infer<typeof DhcpReservationSchema>
export type DhcpLease = z.infer<typeof DhcpLeaseSchema>
export type ServerServices = z.infer<typeof ServerServicesSchema>
export type DnsRecord = z.infer<typeof DnsRecordSchema>
export type DnsRecordType = DnsRecord['type']
export type DnsZone = z.infer<typeof DnsZoneSchema>
export type DnsServer = z.infer<typeof DnsServerSchema>
export type AdContainer = z.infer<typeof AdContainerSchema>
export type AdUser = z.infer<typeof AdUserSchema>
export type AdGroup = z.infer<typeof AdGroupSchema>
export type AdComputer = z.infer<typeof AdComputerSchema>
export type Domain = z.infer<typeof DomainSchema>
export type HostDevice = ServerDevice | ClientDevice
export type LinkEnd = z.infer<typeof LinkEndSchema>
export type Link = z.infer<typeof LinkSchema>
export type LabState = z.infer<typeof LabStateSchema>
