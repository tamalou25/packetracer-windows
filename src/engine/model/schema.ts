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

// Messages de validation en français (fichiers .slab et labs importés) : locale fournie par zod
z.config(z.locales.fr())

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

/** Numéro de VLAN 802.1Q utilisable (1 à 4094). */
export const VlanIdSchema = z.number().int().min(1).max(4094)

/** Configuration 802.1Q d'un port de switch (absente : port d'accès du VLAN 1). */
export const SwitchportSchema = z.object({
  mode: z.enum(['access', 'trunk']).default('access'),
  /** VLAN d'un port d'accès (trames non étiquetées). */
  accessVlan: VlanIdSchema.default(1),
  /** VLAN natif d'un trunk : ses trames circulent sans étiquette. */
  nativeVlan: VlanIdSchema.default(1),
  /** VLAN autorisés sur le trunk (null : tous). */
  allowedVlans: z.array(VlanIdSchema).nullable().default(null)
})

/** Sous-interface de routeur (Gi0/0.10) : carte physique parente et VLAN de l'encapsulation dot1Q. */
export const SubinterfaceSchema = z.object({ parent: z.string(), vlan: VlanIdSchema })

/** VLAN de la base d'un switch. */
export const VlanSchema = z.object({ id: VlanIdSchema, name: z.string() })

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
  dhcpReleased: z.boolean().default(false),
  /**
   * Carte physique liée à un commutateur virtuel externe Hyper-V (identifiant du commutateur) :
   * elle ne porte plus d'adresse IP et transmet les trames du commutateur sur son câble.
   */
  bridge: z.string().nullable().default(null),
  /** Port de switch : mode accès ou trunk 802.1Q (absent : accès, VLAN 1). */
  switchport: SwitchportSchema.optional(),
  /** Sous-interface de routeur (sans câble propre : elle utilise celui de sa carte parente). */
  subinterface: SubinterfaceSchema.optional(),
  /** Interface de routeur : serveurs DHCP vers lesquels relayer les diffusions (ip helper-address). */
  helperAddresses: z.array(z.string()).optional()
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
  domain: z.string().nullable().default(null),
  /** Contrôleur qui a authentifié la session de domaine (%LOGONSERVER%). */
  logonServer: z.string().optional()
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

// ---------------------------------------------------------------------------
// Pare-feu Windows Defender (profils, règles locales et de stratégie de groupe)
// ---------------------------------------------------------------------------

/** Profils du pare-feu : réseau du domaine, privé ou public. */
export const FIREWALL_PROFILES = ['Domain', 'Private', 'Public'] as const
export const FIREWALL_PROTOCOLS = ['Any', 'TCP', 'UDP', 'ICMPv4'] as const

/** Règle de pare-feu (créée localement, par stratégie de groupe, ou prédéfinie). */
export const FirewallRuleSchema = z.object({
  /** Nom unique de la règle (Name de New-NetFirewallRule). */
  id: z.string(),
  displayName: z.string(),
  /** Groupe de règles (DisplayGroup), vide pour une règle personnalisée. */
  group: z.string().default(''),
  direction: z.enum(['Inbound', 'Outbound']),
  action: z.enum(['Allow', 'Block']),
  enabled: z.boolean().default(true),
  protocol: z.enum(FIREWALL_PROTOCOLS).default('Any'),
  /** Ports locaux (vide : tous). */
  localPorts: z.array(z.number().int().min(1).max(65535)).default([]),
  /** Adresses distantes, adresse ou réseau CIDR (vide : toutes). */
  remoteAddresses: z.array(z.string()).default([]),
  /** Profils auxquels la règle s'applique (vide : tous). */
  profiles: z.array(z.enum(FIREWALL_PROFILES)).default([])
})

export const FirewallProfileSchema = z.object({
  enabled: z.boolean().default(true),
  defaultInbound: z.enum(['Block', 'Allow']).default('Block'),
  defaultOutbound: z.enum(['Block', 'Allow']).default('Allow')
})

const defaultFirewallProfile = () => ({
  enabled: true,
  defaultInbound: 'Block' as const,
  defaultOutbound: 'Allow' as const
})

/** Pare-feu d'un ordinateur : configuration locale (les stratégies de groupe s'y ajoutent). */
export const FirewallSchema = z.object({
  profiles: z
    .object({
      Domain: FirewallProfileSchema.default(defaultFirewallProfile),
      Private: FirewallProfileSchema.default(defaultFirewallProfile),
      Public: FirewallProfileSchema.default(defaultFirewallProfile)
    })
    .default(() => ({
      Domain: defaultFirewallProfile(),
      Private: defaultFirewallProfile(),
      Public: defaultFirewallProfile()
    })),
  /** Catégorie du réseau hors domaine (Public par défaut). */
  networkCategory: z.enum(['Public', 'Private']).default('Public'),
  /** Règles prédéfinies activées ou désactivées par l'administrateur (nom → activée). */
  predefined: z.record(z.string(), z.boolean()).default({}),
  /** Règles créées localement. */
  rules: z.array(FirewallRuleSchema).default([])
})

/** Connexion VPN configurée sur un ordinateur (Paramètres > Réseau > VPN, Add-VpnConnection). */
export const VpnConnectionSchema = z.object({
  name: z.string(),
  /** Nom ou adresse du serveur VPN. */
  server: z.string(),
  /** Connexion établie : adresse attribuée par le serveur (pool) et extrémité du tunnel. */
  connected: z
    .object({
      address: z.string(),
      serverDeviceId: z.string(),
      /** Adresse publique du serveur jointe par le client. */
      serverAddress: z.string(),
      /** Adresse du client vue par le serveur (extrémité du tunnel). */
      clientAddress: z.string(),
      user: z.string()
    })
    .nullable()
    .default(null)
})

/** Styles du papier peint (Remplir, Ajuster, Étirer, Vignette, Centrer, Étendre). */
export const WALLPAPER_STYLES = ['Fill', 'Fit', 'Stretch', 'Tile', 'Center', 'Span'] as const

/** « Papier peint du Bureau » (Configuration utilisateur > Modèles d'administration > Bureau > Bureau). */
export const WallpaperPolicySchema = z.object({
  state: PolicyStateSchema.default('NotConfigured'),
  /** Chemin local ou UNC de l'image. */
  path: z.string().default(''),
  style: z.enum(WALLPAPER_STYLES).default('Fill')
})

/**
 * « Spécifier l’emplacement intranet du service de mise à jour Microsoft »
 * (Configuration ordinateur > Modèles d'administration > Composants Windows > Windows Update).
 */
export const WuServerPolicySchema = z.object({
  state: PolicyStateSchema.default('NotConfigured'),
  /** Service intranet de détection des mises à jour (http://srv1.lab.local:8530). */
  url: z.string().default('')
})

/** « Autoriser le ciblage côté client » : groupe d'ordinateurs WSUS demandé par le poste. */
export const WuTargetGroupPolicySchema = z.object({
  state: PolicyStateSchema.default('NotConfigured'),
  group: z.string().default('')
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
  logonMessageText: z.string().nullable().default(null),
  /** Windows Update : serveur WSUS intranet. */
  wuServer: WuServerPolicySchema.default(() => ({ state: 'NotConfigured' as const, url: '' })),
  /** Windows Update : ciblage côté client (groupe WSUS). */
  wuTargetGroup: WuTargetGroupPolicySchema.default(() => ({ state: 'NotConfigured' as const, group: '' })),
  /** Client des services de certificats – Inscription automatique. */
  autoEnrollment: PolicyStateSchema.default('NotConfigured'),
  /** Pare-feu Windows Defender : protéger toutes les connexions réseau (profil du domaine). */
  firewallDomain: PolicyStateSchema.default('NotConfigured'),
  /** Pare-feu Windows Defender : protéger toutes les connexions réseau (profils privé et public). */
  firewallStandard: PolicyStateSchema.default('NotConfigured'),
  /** Règles de pare-feu déployées par la stratégie (s'ajoutent aux règles locales). */
  firewallRules: z.array(FirewallRuleSchema).default([])
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
  logonMessageText: null,
  wuServer: { state: 'NotConfigured', url: '' },
  wuTargetGroup: { state: 'NotConfigured', group: '' },
  autoEnrollment: 'NotConfigured',
  firewallDomain: 'NotConfigured',
  firewallStandard: 'NotConfigured',
  firewallRules: []
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

/**
 * Certificat du magasin de l'ordinateur (Cert:\LocalMachine\My ou Root).
 * Chaîne de confiance : un certificat est approuvé si son émetteur est dans le magasin Root.
 */
export const CertificateSchema = z.object({
  /** Empreinte (40 caractères hexadécimaux, dérivée de state.seq). */
  thumbprint: z.string(),
  /** Sujet (CN=intranet.lab.local). */
  subject: z.string(),
  issuer: z.string(),
  /** Noms DNS couverts (extension Autre nom de l'objet). */
  dnsNames: z.array(z.string()).default([]),
  notBefore: z.number().default(0),
  notAfter: z.number().default(0),
  store: z.enum(['My', 'Root']).default('My'),
  /** Certificat d'autorité de certification. */
  ca: z.boolean().default(false),
  /** Empreinte du certificat émetteur (null = auto-signé). */
  issuerThumbprint: z.string().nullable().default(null)
})

/** Bureau à distance (Propriétés système > Utilisation à distance). */
export const RemoteDesktopSchema = z.object({
  /** « Autoriser les connexions à distance à cet ordinateur ». */
  enabled: z.boolean().default(false),
  /** Groupe local « Utilisateurs du Bureau à distance » (comptes DOMAINE\nom). */
  users: z.array(z.string()).default([])
})

/** Session Bureau à distance ouverte sur l'ordinateur (ouverture de session de type 10). */
export const RemoteSessionSchema = z.object({
  id: z.number().int(),
  /** Compte DOMAINE\nom. */
  account: z.string(),
  /** Ordinateur client. */
  from: z.string(),
  /** Programme RemoteApp (null : bureau complet). */
  app: z.string().nullable().default(null),
  at: z.number().default(0)
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
  /** Magasins de certificats de l'ordinateur (Personnel et Autorités de certification racines). */
  certificates: z.array(CertificateSchema).default([]),
  remoteDesktop: RemoteDesktopSchema.default(() => ({ enabled: false, users: [] })),
  remoteSessions: z.array(RemoteSessionSchema).default([]),
  firewall: FirewallSchema.default(() => FirewallSchema.parse({})),
  vpnConnections: z.array(VpnConnectionSchema).default([]),
  /** Protocole SMB 1.0 accepté par le serveur SMB (EnableSMB1Protocol). */
  smb1: z.boolean().default(false),
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
  interfaces: z.array(NetInterfaceSchema),
  /** Hôte Hyper-V d'une machine virtuelle ou d'un commutateur virtuel (null : équipement physique). */
  hostedBy: z.string().nullable().default(null)
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
export const SwitchDeviceSchema = z.object({
  ...deviceBase,
  kind: z.literal('switch'),
  /** Base des VLAN (VLAN 1 « default » toujours présent). */
  vlans: z.array(VlanSchema).default(() => [{ id: 1, name: 'default' }])
})
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
  b: LinkEndSchema,
  /** Liaison virtuelle à l'intérieur d'un hôte Hyper-V (carte de VM ou vEthernet ↔ commutateur virtuel). */
  virtual: z.boolean().default(false)
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
  builtin: z.boolean().default(false),
  /** Le mot de passe n'expire jamais (PasswordNeverExpires). */
  passwordNeverExpires: z.boolean().default(false),
  /** Horloge de la création du compte (whenCreated). */
  whenCreated: z.number().default(0),
  /** Horloge de la dernière ouverture de session (lastLogonTimestamp) ; null : jamais. */
  lastLogon: z.number().nullable().default(null)
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

/** Objet supprimé conservé par la Corbeille Active Directory (attributs et appartenances). */
export const DeletedAdObjectSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('user'),
    obj: AdUserSchema,
    memberOf: z.array(z.string()).default([]),
    deletedAt: z.number().default(0)
  }),
  z.object({
    kind: z.literal('group'),
    obj: AdGroupSchema,
    memberOf: z.array(z.string()).default([]),
    deletedAt: z.number().default(0)
  }),
  z.object({
    kind: z.literal('computer'),
    obj: AdComputerSchema,
    memberOf: z.array(z.string()).default([]),
    deletedAt: z.number().default(0)
  }),
  z.object({
    kind: z.literal('container'),
    obj: AdContainerSchema,
    memberOf: z.array(z.string()).default([]),
    deletedAt: z.number().default(0)
  })
])

/** Site créé avec la forêt. */
export const DEFAULT_AD_SITE = 'Default-First-Site-Name'
/** Lien de sites créé avec la forêt (transport IP). */
export const DEFAULT_AD_SITE_LINK = 'DEFAULTIPSITELINK'

/** Site Active Directory (Sites et services Active Directory). */
export const AdSiteSchema = z.object({
  name: z.string(),
  description: z.string().default('')
})

/** Sous-réseau associé à un site (192.168.20.0/24). */
export const AdSubnetSchema = z.object({
  prefix: z.string(),
  site: z.string(),
  description: z.string().default('')
})

/** Lien de sites (transport IP) : coût et intervalle de réplication en minutes. */
export const AdSiteLinkSchema = z.object({
  name: z.string(),
  sites: z.array(z.string()).default([]),
  cost: z.number().int().default(100),
  interval: z.number().int().default(180)
})

/** Rôles de maître d'opérations (FSMO), noms de Move-ADDirectoryServerOperationMasterRole. */
export const FSMO_ROLES = [
  'SchemaMaster',
  'DomainNamingMaster',
  'PDCEmulator',
  'RIDMaster',
  'InfrastructureMaster'
] as const

/** État d'une connexion de réplication entrante (contrôleur ← partenaire). */
export const ReplicationStatusSchema = z.object({
  dcId: z.string(),
  partnerId: z.string(),
  lastAttempt: z.number().nullable().default(null),
  lastSuccess: z.number().nullable().default(null),
  /** 0 : succès ; sinon code d'erreur Windows (1722 : serveur RPC indisponible). */
  result: z.number().int().default(0),
  failures: z.number().int().default(0)
})

export const ReplicationStateSchema = z.object({
  status: z.array(ReplicationStatusSchema).default([]),
  /**
   * Contenu des zones DNS intégrées à AD lors de la dernière réplication réussie de chaque
   * contrôleur (contrôleur → zone → clés « nom|type|données ») : base de la fusion multimaître.
   */
  dnsBase: z.record(z.string(), z.record(z.string(), z.array(z.string()))).default({}),
  /** Horloge de la dernière réplication réussie de chaque contrôleur (base la plus récente). */
  syncedAt: z.record(z.string(), z.number()).default({})
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
  gpLinks: z.array(GpLinkSchema).default([]),
  /** Corbeille Active Directory activée (irréversible). */
  recycleBin: z.boolean().default(false),
  /** Objets supprimés restaurables (Corbeille activée). */
  deletedObjects: z.array(DeletedAdObjectSchema).default([]),
  sites: z.array(AdSiteSchema).default(() => [{ name: DEFAULT_AD_SITE, description: '' }]),
  subnets: z.array(AdSubnetSchema).default([]),
  siteLinks: z
    .array(AdSiteLinkSchema)
    .default(() => [{ name: DEFAULT_AD_SITE_LINK, sites: [DEFAULT_AD_SITE], cost: 100, interval: 180 }]),
  /** Site de chaque contrôleur (identifiant d'équipement → site ; absent : premier site). */
  dcSites: z.record(z.string(), z.string()).default({}),
  /** Détenteur de chaque rôle FSMO (rôle → identifiant d'équipement ; absent : premier contrôleur). */
  fsmo: z.record(z.string(), z.string()).default({}),
  replication: ReplicationStateSchema.default(() => ({ status: [], dnsBase: {}, syncedAt: {} }))
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
export type Switchport = z.infer<typeof SwitchportSchema>
export type FirewallRule = z.infer<typeof FirewallRuleSchema>
export type VpnConnection = z.infer<typeof VpnConnectionSchema>
export type AdSite = z.infer<typeof AdSiteSchema>
export type AdSubnet = z.infer<typeof AdSubnetSchema>
export type AdSiteLink = z.infer<typeof AdSiteLinkSchema>
export type FsmoRole = (typeof FSMO_ROLES)[number]
export type ReplicationStatus = z.infer<typeof ReplicationStatusSchema>
export type FirewallProfileName = (typeof FIREWALL_PROFILES)[number]
export type FirewallState = z.infer<typeof FirewallSchema>
export type Subinterface = z.infer<typeof SubinterfaceSchema>
export type Vlan = z.infer<typeof VlanSchema>
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
export type Certificate = z.infer<typeof CertificateSchema>
export type DeletedAdObject = z.infer<typeof DeletedAdObjectSchema>
export type RemoteSession = z.infer<typeof RemoteSessionSchema>
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
