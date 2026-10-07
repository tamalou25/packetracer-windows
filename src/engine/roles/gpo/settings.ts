/**
 * Catalogue des paramètres de stratégie simulés : arborescence de l'éditeur, libellés,
 * textes d'aide et mise en forme pour les rapports (console, gpresult /v).
 */
import type {
  AuditSetting,
  DriveMap,
  FirewallRule,
  GpoComputerSettings,
  GpoStatus,
  GpoUserSettings,
  PolicyState,
  WallpaperStyle
} from '../../model/schema'
import type { PolicyPart } from './scope'

export interface PolicyNode {
  id: string
  label: string
  children?: PolicyNode[]
}

export type SettingKey =
  | 'minPasswordLength'
  | 'passwordComplexity'
  | 'logonMessageTitle'
  | 'logonMessageText'
  | 'wuServer'
  | 'wuTargetGroup'
  | 'autoEnrollment'
  | 'firewallDomain'
  | 'firewallStandard'
  | 'wallpaper'
  | 'noRun'
  | 'noControlPanel'
  | 'noCmd'
  | 'lockoutThreshold'
  | 'lockoutDuration'
  | 'lockoutReset'
  | 'auditLogon'
  | 'auditAccountManagement'

export interface PolicySettingInfo {
  key: SettingKey
  part: PolicyPart
  /** Nœud de l'éditeur contenant le paramètre. */
  node: string
  label: string
  /** Type d'éditeur : modèle d'administration (3 états), nombre, booléen, texte. */
  kind: 'template' | 'number' | 'boolean' | 'text' | 'multiline' | 'audit'
  /** Catégorie affichée dans les rapports. */
  category: string
  help: string
  /** Paramètre numérique : texte autour du champ, bornes et valeur proposée. */
  number?: { before: string; after: string; min: number; max: number; initial: number }
}

/** Arborescence de l'Éditeur de gestion des stratégies de groupe (parties simulées). */
export const EDITOR_TREE: PolicyNode[] = [
  {
    id: 'computer',
    label: 'Configuration ordinateur',
    children: [
      {
        id: 'c-policies',
        label: 'Stratégies',
        children: [
          { id: 'c-software', label: 'Paramètres du logiciel' },
          {
            id: 'c-windows',
            label: 'Paramètres Windows',
            children: [
              {
                id: 'c-security',
                label: 'Paramètres de sécurité',
                children: [
                  {
                    id: 'c-accounts',
                    label: 'Stratégies de comptes',
                    children: [
                      { id: 'c-password', label: 'Stratégie de mot de passe' },
                      { id: 'c-lockout', label: 'Stratégie de verrouillage du compte' }
                    ]
                  },
                  {
                    id: 'c-local',
                    label: 'Stratégies locales',
                    children: [
                      { id: 'c-auditpol', label: 'Stratégie d’audit' },
                      { id: 'c-secopts', label: 'Options de sécurité' }
                    ]
                  },
                  { id: 'c-pki', label: 'Stratégies de clé publique' },
                  {
                    id: 'c-firewall',
                    label: 'Pare-feu Windows Defender avec fonctions avancées de sécurité',
                    children: [{ id: 'c-fw-inbound', label: 'Règles de trafic entrant' }]
                  }
                ]
              }
            ]
          },
          {
            id: 'c-admx',
            label: 'Modèles d’administration',
            children: [
              {
                id: 'c-network',
                label: 'Réseau',
                children: [
                  {
                    id: 'c-netconn',
                    label: 'Connexions réseau',
                    children: [
                      {
                        id: 'c-wf',
                        label: 'Pare-feu Windows Defender',
                        children: [
                          { id: 'c-wf-domain', label: 'Profil du domaine' },
                          { id: 'c-wf-standard', label: 'Profil standard' }
                        ]
                      }
                    ]
                  }
                ]
              },
              {
                id: 'c-components',
                label: 'Composants Windows',
                children: [{ id: 'c-wu', label: 'Windows Update' }]
              }
            ]
          }
        ]
      },
      { id: 'c-prefs', label: 'Préférences' }
    ]
  },
  {
    id: 'user',
    label: 'Configuration utilisateur',
    children: [
      {
        id: 'u-policies',
        label: 'Stratégies',
        children: [
          { id: 'u-software', label: 'Paramètres du logiciel' },
          { id: 'u-windows', label: 'Paramètres Windows' },
          {
            id: 'u-admx',
            label: 'Modèles d’administration',
            children: [
              { id: 'u-desktop', label: 'Bureau', children: [{ id: 'u-desktop-desktop', label: 'Bureau' }] },
              { id: 'u-startmenu', label: 'Menu Démarrer et barre des tâches' },
              { id: 'u-control', label: 'Panneau de configuration' },
              { id: 'u-system', label: 'Système' }
            ]
          }
        ]
      },
      {
        id: 'u-prefs',
        label: 'Préférences',
        children: [
          {
            id: 'u-prefs-windows',
            label: 'Paramètres Windows',
            children: [{ id: 'u-drivemaps', label: 'Mappages de lecteurs' }]
          }
        ]
      }
    ]
  }
]

export const POLICY_SETTINGS: PolicySettingInfo[] = [
  {
    key: 'minPasswordLength',
    part: 'computer',
    node: 'c-password',
    label: 'Longueur minimale du mot de passe',
    kind: 'number',
    category: 'Stratégies de comptes / Stratégie de mot de passe',
    help: 'Détermine le nombre minimal de caractères d’un mot de passe de compte (de 0 à 14). La valeur 0 autorise un mot de passe vide. Dans un domaine, seule la valeur définie par une GPO liée à la racine du domaine s’applique aux comptes du domaine.',
    number: {
      before: 'Le mot de passe doit comporter au moins :',
      after: 'caractères',
      min: 0,
      max: 14,
      initial: 7
    }
  },
  {
    key: 'passwordComplexity',
    part: 'computer',
    node: 'c-password',
    label: 'Le mot de passe doit respecter des exigences de complexité',
    kind: 'boolean',
    category: 'Stratégies de comptes / Stratégie de mot de passe',
    help: 'Si ce paramètre est activé, un mot de passe ne doit pas contenir le nom du compte et doit comporter des caractères d’au moins trois des catégories suivantes : majuscules, minuscules, chiffres et caractères non alphanumériques. Comme la longueur minimale, il ne s’applique aux comptes du domaine que depuis une GPO liée à la racine du domaine.'
  },
  {
    key: 'lockoutDuration',
    part: 'computer',
    node: 'c-lockout',
    label: 'Durée de verrouillage des comptes',
    kind: 'number',
    category: 'Stratégies de comptes / Stratégie de verrouillage du compte',
    help: 'Détermine le nombre de minutes pendant lesquelles un compte verrouillé le reste avant d’être déverrouillé automatiquement (de 0 à 99 999). La valeur 0 garde le compte verrouillé jusqu’à ce qu’un administrateur le déverrouille. Ce paramètre n’a de sens que si un seuil de verrouillage est défini.',
    number: {
      before: 'Le compte est verrouillé pendant :',
      after: 'minutes',
      min: 0,
      max: 99999,
      initial: 30
    }
  },
  {
    key: 'lockoutThreshold',
    part: 'computer',
    node: 'c-lockout',
    label: 'Seuil de verrouillage du compte',
    kind: 'number',
    category: 'Stratégies de comptes / Stratégie de verrouillage du compte',
    help: 'Détermine le nombre de tentatives d’ouverture de session infructueuses qui entraînent le verrouillage du compte (de 0 à 999). La valeur 0 désactive le verrouillage. Un compte verrouillé ne peut plus ouvrir de session tant qu’il n’est pas déverrouillé.',
    number: {
      before: 'Le compte se verrouillera après :',
      after: 'tentatives d’ouvertures de session non valides',
      min: 0,
      max: 999,
      initial: 0
    }
  },
  {
    key: 'lockoutReset',
    part: 'computer',
    node: 'c-lockout',
    label: 'Réinitialiser le compteur de verrouillages du compte après',
    kind: 'number',
    category: 'Stratégies de comptes / Stratégie de verrouillage du compte',
    help: 'Détermine le nombre de minutes qui doivent s’écouler après un échec d’ouverture de session pour que le compteur d’échecs revienne à 0 (de 1 à 99 999). Cette valeur doit être inférieure ou égale à la durée de verrouillage.',
    number: {
      before: 'Réinitialiser le compteur de verrouillages du compte après :',
      after: 'minutes',
      min: 1,
      max: 99999,
      initial: 30
    }
  },
  {
    key: 'auditAccountManagement',
    part: 'computer',
    node: 'c-auditpol',
    label: 'Auditer la gestion des comptes',
    kind: 'audit',
    category: 'Stratégies locales / Stratégie d’audit',
    help: 'Détermine si l’ordinateur audite la gestion des comptes : création, modification, appartenance aux groupes, verrouillage (événements 4720, 4728, 4740…). Sur un contrôleur de domaine, ces événements sont inscrits dans son journal Sécurité.'
  },
  {
    key: 'auditLogon',
    part: 'computer',
    node: 'c-auditpol',
    label: 'Auditer les événements de connexion',
    kind: 'audit',
    category: 'Stratégies locales / Stratégie d’audit',
    help: 'Détermine si l’ordinateur audite les ouvertures de session réussies (4624, 4672) et/ou les échecs (4625) sur cet ordinateur.'
  },
  {
    key: 'logonMessageTitle',
    part: 'computer',
    node: 'c-secopts',
    label:
      'Ouverture de session interactive : titre du message pour les utilisateurs qui essaient de se connecter',
    kind: 'text',
    category: 'Stratégies locales / Options de sécurité',
    help: 'Titre de la fenêtre de message affichée avant l’ouverture de session, après Ctrl+Alt+Suppr. Paramètre de l’ordinateur : il est appliqué au démarrage ou par gpupdate.'
  },
  {
    key: 'logonMessageText',
    part: 'computer',
    node: 'c-secopts',
    label:
      'Ouverture de session interactive : contenu du message pour les utilisateurs qui essaient de se connecter',
    kind: 'multiline',
    category: 'Stratégies locales / Options de sécurité',
    help: 'Texte affiché avant l’ouverture de session, par exemple un avertissement sur l’usage du système d’information. L’utilisateur doit le valider avant de saisir ses identifiants.'
  },
  {
    key: 'autoEnrollment',
    part: 'computer',
    node: 'c-pki',
    label: 'Client des services de certificats – Inscription automatique',
    kind: 'template',
    category: 'Paramètres de sécurité / Stratégies de clé publique',
    help: 'Activé : l’ordinateur demande automatiquement à l’autorité de certification d’entreprise du domaine les certificats des modèles publiés pour lesquels il a l’autorisation d’inscription (modèle Ordinateur), puis les renouvelle. Appliqué au démarrage, par gpupdate ou par certutil -pulse.'
  },
  {
    key: 'firewallDomain',
    part: 'computer',
    node: 'c-wf-domain',
    label: 'Pare-feu Windows Defender : protéger toutes les connexions réseau',
    kind: 'template',
    category:
      'Modèles d’administration / Réseau / Connexions réseau / Pare-feu Windows Defender / Profil du domaine',
    help: 'Activé : le pare-feu protège les connexions de l’ordinateur lorsqu’il est connecté au réseau de son domaine ; l’administrateur local ne peut pas le désactiver. Désactivé : le pare-feu ne filtre plus le trafic sur le réseau du domaine. Non configuré : le réglage local s’applique.'
  },
  {
    key: 'firewallStandard',
    part: 'computer',
    node: 'c-wf-standard',
    label: 'Pare-feu Windows Defender : protéger toutes les connexions réseau',
    kind: 'template',
    category:
      'Modèles d’administration / Réseau / Connexions réseau / Pare-feu Windows Defender / Profil standard',
    help: 'Profil standard : réseaux privés et publics (hors domaine). Activé : le pare-feu protège ces connexions ; Désactivé : il ne filtre plus le trafic ; Non configuré : le réglage local s’applique.'
  },
  {
    key: 'wuServer',
    part: 'computer',
    node: 'c-wu',
    label: 'Spécifier l’emplacement intranet du service de mise à jour Microsoft',
    kind: 'template',
    category: 'Modèles d’administration / Composants Windows / Windows Update',
    help: 'Indique un serveur intranet (WSUS) qui héberge les mises à jour : les ordinateurs le contactent pour rechercher les mises à jour au lieu du service de mise à jour sur Internet. Indiquez l’URL du service, par exemple http://srv1.lab.local:8530 (port HTTP de WSUS). Paramètre de l’ordinateur : il est appliqué au démarrage ou par gpupdate.'
  },
  {
    key: 'wuTargetGroup',
    part: 'computer',
    node: 'c-wu',
    label: 'Autoriser le ciblage côté client',
    kind: 'template',
    category: 'Modèles d’administration / Composants Windows / Windows Update',
    help: 'Indique le groupe d’ordinateurs WSUS auquel l’ordinateur demande à appartenir. Sans effet si le serveur WSUS utilise le ciblage côté serveur (console Update Services). Si le groupe n’existe pas sur le serveur, l’ordinateur est placé dans « Ordinateurs non attribués ».'
  },
  {
    key: 'wallpaper',
    part: 'user',
    node: 'u-desktop-desktop',
    label: 'Papier peint du Bureau',
    kind: 'template',
    category: 'Modèles d’administration / Bureau / Bureau',
    help: 'Impose le papier peint du Bureau des utilisateurs et les empêche de le modifier. Indiquez le chemin local (C:\\…) ou réseau (\\\\serveur\\partage\\image.jpg) de l’image : elle doit être accessible à l’utilisateur, sinon le Bureau reste noir. Désactivé ou non configuré : l’utilisateur choisit son papier peint.'
  },
  {
    key: 'noRun',
    part: 'user',
    node: 'u-startmenu',
    label: 'Supprimer le menu Exécuter du menu Démarrer',
    kind: 'template',
    category: 'Modèles d’administration / Menu Démarrer et barre des tâches',
    help: 'Supprime la commande Exécuter du menu Démarrer et du menu d’administration du bouton Démarrer, et empêche d’ouvrir la boîte de dialogue Exécuter.'
  },
  {
    key: 'noControlPanel',
    part: 'user',
    node: 'u-control',
    label: 'Interdire l’accès au Panneau de configuration et à l’application Paramètres du PC',
    kind: 'template',
    category: 'Modèles d’administration / Panneau de configuration',
    help: 'Désactive le Panneau de configuration et ses éléments (connexions réseau, propriétés système…). Toute tentative d’ouverture affiche un message indiquant qu’une restriction empêche l’opération.'
  },
  {
    key: 'noCmd',
    part: 'user',
    node: 'u-system',
    label: 'Désactiver l’accès à l’invite de commandes',
    kind: 'template',
    category: 'Modèles d’administration / Système',
    help: 'Empêche l’exécution de l’invite de commandes (cmd.exe) : elle affiche un message indiquant qu’elle a été désactivée par l’administrateur. PowerShell n’est pas concerné par ce paramètre.'
  }
]

export const POLICY_STATE_LABELS: Record<PolicyState, string> = {
  NotConfigured: 'Non configuré',
  Enabled: 'Activé',
  Disabled: 'Désactivé'
}

export const WALLPAPER_STYLE_LABELS: Record<WallpaperStyle, string> = {
  Fill: 'Remplir',
  Fit: 'Ajuster',
  Stretch: 'Étirer',
  Tile: 'Vignette',
  Center: 'Centrer',
  Span: 'Étendre'
}

export const DRIVE_ACTION_LABELS: Record<DriveMap['action'], string> = {
  Create: 'Créer',
  Replace: 'Remplacer',
  Update: 'Mettre à jour',
  Delete: 'Supprimer'
}

export const GPO_STATUS_LABELS: Record<GpoStatus, string> = {
  AllSettingsEnabled: 'Activé',
  UserSettingsDisabled: 'Paramètres de configuration utilisateur désactivés',
  ComputerSettingsDisabled: 'Paramètres de configuration ordinateur désactivés',
  AllSettingsDisabled: 'Tous les paramètres désactivés'
}

export function settingInfo(key: SettingKey): PolicySettingInfo {
  return POLICY_SETTINGS.find((s) => s.key === key) as PolicySettingInfo
}

/** État d'un paramètre de modèle d'administration (null : paramètre d'un autre type). */
export function templateState(
  key: SettingKey,
  computer: GpoComputerSettings,
  user: GpoUserSettings
): PolicyState | null {
  switch (key) {
    case 'wuServer':
    case 'wuTargetGroup':
      return computer[key].state
    case 'autoEnrollment':
      return computer.autoEnrollment
    case 'firewallDomain':
    case 'firewallStandard':
      return computer[key]
    case 'wallpaper':
      return user.wallpaper.state
    case 'noRun':
    case 'noControlPanel':
    case 'noCmd':
      return user[key]
    default:
      return null
  }
}

/** Valeur affichée d'un paramètre, ou null s'il n'est pas configuré. */
export function settingValue(
  key: SettingKey,
  computer: GpoComputerSettings,
  user: GpoUserSettings
): string | null {
  switch (key) {
    case 'minPasswordLength':
      return computer.minPasswordLength === null ? null : `${computer.minPasswordLength} caractère(s)`
    case 'passwordComplexity':
      return computer.passwordComplexity === null
        ? null
        : computer.passwordComplexity
          ? 'Activé'
          : 'Désactivé'
    case 'logonMessageTitle':
      return computer.logonMessageTitle
    case 'logonMessageText':
      return computer.logonMessageText
    case 'autoEnrollment':
      return computer.autoEnrollment === 'NotConfigured' ? null : POLICY_STATE_LABELS[computer.autoEnrollment]
    case 'firewallDomain':
    case 'firewallStandard':
      return computer[key] === 'NotConfigured' ? null : POLICY_STATE_LABELS[computer[key]]
    case 'wuServer':
      if (computer.wuServer.state === 'NotConfigured') return null
      return computer.wuServer.state === 'Enabled'
        ? `Activé — ${computer.wuServer.url || '(aucun)'}`
        : 'Désactivé'
    case 'wuTargetGroup':
      if (computer.wuTargetGroup.state === 'NotConfigured') return null
      return computer.wuTargetGroup.state === 'Enabled'
        ? `Activé — ${computer.wuTargetGroup.group || '(aucun)'}`
        : 'Désactivé'
    case 'wallpaper':
      if (user.wallpaper.state === 'NotConfigured') return null
      return user.wallpaper.state === 'Enabled'
        ? `Activé — ${user.wallpaper.path || '(aucun)'} (${WALLPAPER_STYLE_LABELS[user.wallpaper.style]})`
        : 'Désactivé'
    case 'noRun':
    case 'noControlPanel':
    case 'noCmd':
      return user[key] === 'NotConfigured' ? null : POLICY_STATE_LABELS[user[key]]
    case 'lockoutThreshold':
      return computer.lockoutThreshold === null
        ? null
        : `${computer.lockoutThreshold} tentative(s) d’ouverture de session non valide(s)`
    case 'lockoutDuration':
    case 'lockoutReset':
      return computer[key] === null ? null : `${computer[key]} minute(s)`
    case 'auditLogon':
    case 'auditAccountManagement':
      return computer[key] === null ? null : AUDIT_SETTING_LABELS[computer[key]]
  }
}

/** Libellés des valeurs de la stratégie d'audit. */
export const AUDIT_SETTING_LABELS: Record<AuditSetting, string> = {
  None: 'Pas d’audit',
  Success: 'Succès',
  Failure: 'Échec',
  SuccessAndFailure: 'Succès, Échec'
}

/** Résumé d'une règle de pare-feu : « Autoriser TCP 80, 443 (Domaine) ». */
export function firewallRuleSummary(rule: FirewallRule): string {
  const action = rule.action === 'Allow' ? 'Autoriser' : 'Bloquer'
  const protocol = rule.protocol === 'Any' ? 'tout protocole' : rule.protocol
  const ports = rule.localPorts.length > 0 ? ` ${rule.localPorts.join(', ')}` : ''
  const from = rule.remoteAddresses.length > 0 ? ` depuis ${rule.remoteAddresses.join(', ')}` : ''
  const profiles = rule.profiles.length > 0 ? ` (${rule.profiles.join(', ')})` : ''
  return `${action} ${protocol}${ports}${from}${profiles}${rule.enabled ? '' : ' — désactivée'}`
}

export interface SettingLine {
  category: string
  label: string
  value: string
}

/** Paramètres configurés d'une partie (rapport de la console, gpresult /v). */
export function describeSettings(
  part: PolicyPart,
  computer: GpoComputerSettings,
  user: GpoUserSettings
): SettingLine[] {
  const lines: SettingLine[] = POLICY_SETTINGS.filter((s) => s.part === part).flatMap((s) => {
    const value = settingValue(s.key, computer, user)
    return value === null ? [] : [{ category: s.category, label: s.label, value }]
  })
  if (part === 'computer')
    for (const rule of computer.firewallRules)
      lines.push({
        category: 'Paramètres de sécurité / Pare-feu Windows Defender / Règles de trafic entrant',
        label: rule.displayName,
        value: firewallRuleSummary(rule)
      })
  if (part === 'user')
    for (const map of user.driveMaps)
      lines.push({
        category: 'Préférences / Mappages de lecteurs',
        label: `Lecteur ${map.letter}:`,
        value: `${DRIVE_ACTION_LABELS[map.action]} — ${map.path}${map.label ? ` (« ${map.label} »)` : ''}`
      })
  return lines
}
