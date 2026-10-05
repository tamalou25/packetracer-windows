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

/** Lecteur réseau connecté manuellement (net use, « Connecter un lecteur réseau »). */
export const MappedDriveSchema = z.object({
  /** Lettre sans les deux-points (Z). */
  letter: z.string(),
  /** Chemin UNC (\\SRV1\Commun). */
  path: z.string(),
  /** Compte de la session qui a connecté le lecteur (LAB\jdupont). */
  account: z.string(),
  /** Reconnecté à l'ouverture de session suivante. */
  persistent: z.boolean().default(true)
})

/** SID bien connus utilisés dans les listes de contrôle d'accès. */
export const WELL_KNOWN_SIDS = {
  everyone: 'S-1-1-0',
  creatorOwner: 'S-1-3-0',
  authenticatedUsers: 'S-1-5-11',
  system: 'S-1-5-18',
  administrators: 'S-1-5-32-544',
  users: 'S-1-5-32-545'
} as const

// ---------------------------------------------------------------------------
// Stratégies de groupe : paramètres simulés
// ---------------------------------------------------------------------------

/** État d'un paramètre de modèle d'administration. */
export const POLICY_STATES = ['NotConfigured', 'Enabled', 'Disabled'] as const
export const PolicyStateSchema = z.enum(POLICY_STATES)

/** Styles du papier peint (Remplir, Ajuster, Étirer, Vignette, Centrer, Étendre). */
export const WALLPAPER_STYLES = ['Fill', 'Fit', 'Stretch', 'Tile', 'Center', 'Span'] as const

/** « Papier peint du Bureau » (Configuration utilisateur > Modèles d'administration > Bureau > Bureau). */
export const WallpaperPolicySchema = z.object({
  state: PolicyStateSchema.default('NotConfigured'),
  /** Chemin local ou UNC de l'image. */
  path: z.string().default(''),
  style: z.enum(WALLPAPER_STYLES).default('Fill')
})

/** Préférence « Lecteur mappé » (Configuration utilisateur > Préférences > Mappages de lecteurs). */
export const DriveMapSchema = z.object({
  action: z.enum(['Create', 'Replace', 'Update', 'Delete']).default('Update'),
  /** Lettre de lecteur, sans les deux-points (Z). */
  letter: z.string(),
  /** Emplacement UNC (\\SRV1\Commun). */
  path: z.string().default(''),
  /** Libellé affiché dans « Ce PC ». */
  label: z.string().default(''),
  reconnect: z.boolean().default(true)
})

/** Partie « Configuration ordinateur » d'une GPO (sous-ensemble simulé). */
export const GpoComputerSettingsSchema = z.object({
  /** Stratégie de mot de passe : longueur minimale (null = non défini). */
  minPasswordLength: z.number().int().min(0).max(14).nullable().default(null),
  /** Le mot de passe doit respecter des exigences de complexité (null = non défini). */
  passwordComplexity: z.boolean().nullable().default(null),
  /** Ouverture de session interactive : titre du message (null = non défini). */
  logonMessageTitle: z.string().nullable().default(null),
  /** Ouverture de session interactive : texte du message (null = non défini). */
  logonMessageText: z.string().nullable().default(null)
})

/** Partie « Configuration utilisateur » d'une GPO (sous-ensemble simulé). */
export const GpoUserSettingsSchema = z.object({
  wallpaper: WallpaperPolicySchema.default(() => ({
    state: 'NotConfigured' as const,
    path: '',
    style: 'Fill' as const
  })),
  /** Interdire l'accès au Panneau de configuration et à l'application Paramètres du PC. */
  noControlPanel: PolicyStateSchema.default('NotConfigured'),
  /** Supprimer le menu Exécuter du menu Démarrer. */
  noRun: PolicyStateSchema.default('NotConfigured'),
  /** Désactiver l'accès à l'invite de commandes. */
  noCmd: PolicyStateSchema.default('NotConfigured'),
  driveMaps: z.array(DriveMapSchema).default([])
})

/** Paramètres vides (valeurs par défaut des schémas). */
const noComputerSettings = (): z.infer<typeof GpoComputerSettingsSchema> => ({
  minPasswordLength: null,
  passwordComplexity: null,
  logonMessageTitle: null,
  logonMessageText: null
})
const noUserSettings = (): z.infer<typeof GpoUserSettingsSchema> => ({
  wallpaper: { state: 'NotConfigured', path: '', style: 'Fill' },
  noControlPanel: 'NotConfigured',
  noRun: 'NotConfigured',
  noCmd: 'NotConfigured',
  driveMaps: []
})

/** GPO appliquée à un ordinateur ou à un utilisateur (résultat de stratégie). */
export const AppliedGpoSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Emplacement de la liaison (lab.local/Compta). */
  location: z.string().default('')
})

/** GPO de l'étendue non appliquée, avec la raison affichée par gpresult. */
export const FilteredGpoSchema = AppliedGpoSchema.extend({ reason: z.string() })

const policyResultBase = {
  /** Horloge du lab lors du traitement. */
  time: z.number(),
  /** Contrôleur de domaine ayant fourni les stratégies (FQDN). */
  source: z.string().default(''),
  /** Nom distinctif de l'ordinateur ou de l'utilisateur traité. */
  dn: z.string().default(''),
  /** GPO appliquées, de la plus prioritaire à la moins prioritaire. */
  applied: z.array(AppliedGpoSchema).default([]),
  filtered: z.array(FilteredGpoSchema).default([])
}

/** Stratégie d'ordinateur résultante (appliquée au démarrage ou par gpupdate). */
export const ComputerPolicyResultSchema = z.object({
  ...policyResultBase,
  /** Démarrage (bootedAt) au cours duquel la stratégie a été traitée. */
  boot: z.number().default(0),
  settings: GpoComputerSettingsSchema.default(noComputerSettings)
})

/** Stratégie utilisateur résultante (appliquée à l'ouverture de session ou par gpupdate). */
export const UserPolicyResultSchema = z.object({
  ...policyResultBase,
  /** Compte traité (LAB\jdupont). */
  account: z.string(),
  settings: GpoUserSettingsSchema.default(noUserSettings)
})

/** Stratégies de groupe appliquées sur un ordinateur. */
export const HostPolicySchema = z.object({
  computer: ComputerPolicyResultSchema.nullable().default(null),
  user: UserPolicyResultSchema.nullable().default(null),
  /** Dernier traitement automatique tenté (« démarrage|compte ») : évite de réessayer en boucle. */
  attempt: z.string().nullable().default(null)
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
  /** Stratégies de groupe appliquées (ordinateur et utilisateur de la session). */
  policy: HostPolicySchema.default(() => ({ computer: null, user: null, attempt: null })),
  /** Lecteurs réseau connectés (net use). */
  drives: z.array(MappedDriveSchema).default([]),
  eventLog: z.array(EventLogEntrySchema).default([])
})

// ---------------------------------------------------------------------------
// Fichiers : volume C:, autorisations NTFS, partages SMB
// ---------------------------------------------------------------------------

/** Autorisations NTFS de base (onglet Sécurité). */
export const NTFS_RIGHTS = [
  'FullControl',
  'Modify',
  'ReadAndExecute',
  'ListDirectory',
  'Read',
  'Write'
] as const

/** Entrée de contrôle d'accès NTFS explicite. */
export const NtfsAceSchema = z.object({
  /** SID bien connu (S-1-…) ou identifiant d'objet de l'annuaire. */
  principal: z.string(),
  type: z.enum(['Allow', 'Deny']).default('Allow'),
  rights: z.enum(NTFS_RIGHTS)
})

/** Dossier ou fichier du volume C: d'un serveur. */
export const FsNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Dossier parent (null = racine du volume C:\). */
  parentId: z.string().nullable(),
  kind: z.enum(['folder', 'file']),
  /** Taille en octets (fichiers). */
  size: z.number().int().nonnegative().default(0),
  /** Autorisations explicites ; les autorisations héritées sont calculées depuis les parents. */
  acl: z.array(NtfsAceSchema).default([]),
  /** Hérite des autorisations du dossier parent. */
  inherits: z.boolean().default(true),
  owner: z.string().default(WELL_KNOWN_SIDS.administrators),
  modifiedAt: z.number().default(0),
  /** Dossier du système (non supprimable). */
  system: z.boolean().default(false)
})

/** Autorisations de partage (Contrôle total, Modifier, Lecture). */
export const SHARE_RIGHTS = ['Full', 'Change', 'Read'] as const

export const ShareAceSchema = z.object({
  principal: z.string(),
  type: z.enum(['Allow', 'Deny']).default('Allow'),
  rights: z.enum(SHARE_RIGHTS)
})

/** Dossier partagé (SMB). */
export const SmbShareSchema = z.object({
  /** Nom du partage (Compta, Compta$ pour un partage masqué). */
  name: z.string(),
  folderId: z.string(),
  description: z.string().default(''),
  /** Par défaut : Tout le monde, Lecture. */
  acl: z
    .array(ShareAceSchema)
    .default(() => [{ principal: WELL_KNOWN_SIDS.everyone, type: 'Allow' as const, rights: 'Read' as const }])
})

/** Autorisations de la racine C:\ : Administrateurs et SYSTEM (contrôle total), Utilisateurs (lecture). */
export function defaultRootAcl(): z.infer<typeof NtfsAceSchema>[] {
  return [
    { principal: WELL_KNOWN_SIDS.administrators, type: 'Allow', rights: 'FullControl' },
    { principal: WELL_KNOWN_SIDS.system, type: 'Allow', rights: 'FullControl' },
    { principal: WELL_KNOWN_SIDS.users, type: 'Allow', rights: 'ReadAndExecute' }
  ]
}

/** Dossiers présents sur un serveur neuf. */
export function defaultFsNodes(): z.infer<typeof FsNodeSchema>[] {
  const folder = (id: string, name: string, parentId: string | null) => ({
    id,
    name,
    parentId,
    kind: 'folder' as const,
    size: 0,
    acl: [],
    inherits: true,
    owner: WELL_KNOWN_SIDS.administrators,
    modifiedAt: 0,
    system: true
  })
  return [
    folder('fs-perflogs', 'PerfLogs', null),
    folder('fs-programfiles', 'Program Files', null),
    folder('fs-users', 'Users', null),
    folder('fs-users-admin', 'Administrateur', 'fs-users'),
    folder('fs-users-public', 'Public', 'fs-users'),
    folder('fs-windows', 'Windows', null)
  ]
}

/** Stockage d'un serveur : volume C: et partages. */
export const StorageSchema = z.object({
  rootAcl: z.array(NtfsAceSchema).default(defaultRootAcl),
  nodes: z.array(FsNodeSchema).default(defaultFsNodes),
  shares: z.array(SmbShareSchema).default([])
})

/**
 * Données des rôles serveur, par identifiant de rôle (`roles.dhcp`, `roles.dns`…). Chaque module
 * de rôle déclare le schéma de ses données (`RoleModule.state`) : elles sont validées à
 * l'ouverture d'un fichier .slab (`serialization/slab.ts`) et lues par des accesseurs typés.
 */
export const RoleStatesSchema = z.record(z.string(), z.unknown())

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
  roles: RoleStatesSchema.default({}),
  /** Volume C: et dossiers partagés. */
  storage: StorageSchema.default(() => ({ rootAcl: defaultRootAcl(), nodes: defaultFsNodes(), shares: [] }))
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

/** Liaison d'une GPO à la racine du domaine ou à une unité d'organisation (attribut gPLink). */
export const GpLinkSchema = z.object({
  gpoId: z.string(),
  /** Lien activé. */
  enabled: z.boolean().default(true),
  /** Appliqué : ne peut pas être bloqué et l'emporte sur les GPO des OU enfants. */
  enforced: z.boolean().default(false)
})

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
  builtin: z.boolean().default(false),
  /** GPO liées (ordre de liaison : la première est prioritaire). Réservé aux OU. */
  gpLinks: z.array(GpLinkSchema).default([]),
  /** Bloquer l'héritage des GPO des conteneurs parents (sauf liaisons appliquées). */
  blockInheritance: z.boolean().default(false)
})

export const GPO_STATUSES = [
  'AllSettingsEnabled',
  'UserSettingsDisabled',
  'ComputerSettingsDisabled',
  'AllSettingsDisabled'
] as const

/** SID bien connu « Utilisateurs authentifiés » (filtrage de sécurité par défaut). */
export const AUTHENTICATED_USERS_SID = WELL_KNOWN_SIDS.authenticatedUsers

/** Objet de stratégie de groupe (GPO). */
export const GpoSchema = z.object({
  /** GUID de l'objet ({31B2F340-016D-11D2-945F-00C04FB984F9}). */
  id: z.string(),
  name: z.string(),
  comment: z.string().default(''),
  status: z.enum(GPO_STATUSES).default('AllSettingsEnabled'),
  /**
   * Filtrage de sécurité (droit « Appliquer la stratégie de groupe ») : SID bien connu
   * des Utilisateurs authentifiés ou identifiants d'objets de l'annuaire.
   */
  securityFilter: z.array(z.string()).default(() => [AUTHENTICATED_USERS_SID]),
  createdAt: z.number().default(0),
  modifiedAt: z.number().default(0),
  /** Versions incrémentées à chaque modification (0 = partie vide). */
  userVersion: z.number().int().nonnegative().default(0),
  computerVersion: z.number().int().nonnegative().default(0),
  computer: GpoComputerSettingsSchema.default(noComputerSettings),
  user: GpoUserSettingsSchema.default(noUserSettings)
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
  computers: z.array(AdComputerSchema).default([]),
  /** Objets de stratégie de groupe du domaine. */
  gpos: z.array(GpoSchema).default([]),
  /** GPO liées à la racine du domaine (ordre de liaison). */
  gpLinks: z.array(GpLinkSchema).default([])
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
export type AdContainer = z.infer<typeof AdContainerSchema>
export type AdUser = z.infer<typeof AdUserSchema>
export type AdGroup = z.infer<typeof AdGroupSchema>
export type AdComputer = z.infer<typeof AdComputerSchema>
export type Domain = z.infer<typeof DomainSchema>
export type PolicyState = z.infer<typeof PolicyStateSchema>
export type WallpaperStyle = (typeof WALLPAPER_STYLES)[number]
export type WallpaperPolicy = z.infer<typeof WallpaperPolicySchema>
export type DriveMap = z.infer<typeof DriveMapSchema>
export type GpoComputerSettings = z.infer<typeof GpoComputerSettingsSchema>
export type GpoUserSettings = z.infer<typeof GpoUserSettingsSchema>
export type GpLink = z.infer<typeof GpLinkSchema>
export type GpoStatus = (typeof GPO_STATUSES)[number]
export type Gpo = z.infer<typeof GpoSchema>
export type AppliedGpo = z.infer<typeof AppliedGpoSchema>
export type FilteredGpo = z.infer<typeof FilteredGpoSchema>
export type ComputerPolicyResult = z.infer<typeof ComputerPolicyResultSchema>
export type UserPolicyResult = z.infer<typeof UserPolicyResultSchema>
export type HostPolicy = z.infer<typeof HostPolicySchema>
export type MappedDrive = z.infer<typeof MappedDriveSchema>
export type NtfsRight = (typeof NTFS_RIGHTS)[number]
export type NtfsAce = z.infer<typeof NtfsAceSchema>
export type FsNode = z.infer<typeof FsNodeSchema>
export type ShareRight = (typeof SHARE_RIGHTS)[number]
export type ShareAce = z.infer<typeof ShareAceSchema>
export type SmbShare = z.infer<typeof SmbShareSchema>
export type Storage = z.infer<typeof StorageSchema>
export type HostDevice = ServerDevice | ClientDevice
export type LinkEnd = z.infer<typeof LinkEndSchema>
export type Link = z.infer<typeof LinkSchema>
export type RoleStates = z.infer<typeof RoleStatesSchema>
export type LabState = z.infer<typeof LabStateSchema>
