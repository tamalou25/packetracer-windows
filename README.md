# ServerLab

Simulateur desktop d'administration de serveurs, pensé pour réviser l'**épreuve E6 du BTS SIO SISR**.
On construit une topologie (serveurs, postes, switchs, routeurs, Internet), puis on configure
les rôles serveur (AD DS, DNS, DHCP, GPO, partages) via une interface graphique ou des consoles
PowerShell / CMD simulées.

> Tout est **simulé** : aucune machine virtuelle, aucune commande système n'est exécutée.
> Projet indépendant, sans affiliation avec un éditeur de logiciels.

## État d'avancement

| Phase | Contenu                                | État |
| ----- | -------------------------------------- | ---- |
| 1     | Squelette Electron + CI                | ✅   |
| 2     | Canvas de topologie, fichiers `.slab`  | ✅   |
| 3     | Moteur IP, mode Simulation             | ✅   |
| 4     | Consoles PowerShell / CMD              | ✅   |
| 5     | DHCP                                   | ✅   |
| 6     | DNS                                    | ✅   |
| 7     | AD DS                                  | ✅   |
| 7b    | Bureau façon serveur (fenêtres, menus) | ✅   |
| 8     | Stratégies de groupe (GPO)             | ✅   |
| 9     | Fichiers, partages, NTFS               | ✅   |
| 10    | Mode Labs                              | ⏳   |
| 11    | Installeur + mises à jour              | ⏳   |

## Développement

Prérequis : **Node.js 22+** et npm.

```bash
npm ci            # installe les dépendances
npm run dev       # lance l'application en mode développement
npm run lint      # ESLint + Prettier
npm run typecheck # vérification TypeScript
npm test          # tests du moteur (Vitest)
npm run test:e2e  # build + tests E2E (Playwright)
npm run dist      # génère l'installeur dans dist/
```

Sous Linux sans écran (CI, conteneur) : `xvfb-run -a npm run test:e2e`.

## Architecture

| Dossier        | Rôle                                                                     |
| -------------- | ------------------------------------------------------------------------ |
| `src/main`     | Process principal Electron : fenêtre, menu natif, fichiers, mises à jour |
| `src/preload`  | Pont sécurisé (`contextBridge`) exposant une API minimale                |
| `src/renderer` | Interface React (canvas React Flow, panneaux, consoles)                  |
| `src/engine`   | Moteur de simulation **pur TypeScript** (testable seul)                  |
| `labs`         | Labs pédagogiques au format JSON                                         |
| `tests`        | Tests Vitest (moteur) et Playwright (E2E)                                |

Sécurité : `contextIsolation`, `sandbox`, pas de `nodeIntegration`, CSP stricte, navigation bloquée.

Voir [`CLAUDE.md`](./CLAUDE.md) pour les conventions détaillées.

## Stratégies de groupe (GPO)

- Console **Gestion des stratégies de groupe** (`gpmc.msc`, menu Outils du Gestionnaire de serveur) :
  création et liaison de GPO au domaine ou aux OU, ordre des liens, **Appliqué**, lien activé,
  **blocage de l'héritage**, état GPO, filtrage de sécurité, onglets Étendue / Détails / Paramètres.
- **Éditeur de gestion des stratégies de groupe** : stratégie de mot de passe (Default Domain Policy),
  message avant ouverture de session, papier peint, interdiction du Panneau de configuration, du menu
  Exécuter et de l'invite de commandes, mappage de lecteurs réseau (préférences).
- Application réaliste : stratégie d'ordinateur au démarrage, stratégie utilisateur à l'ouverture
  de session, `gpupdate /force`, `gpresult /r` (GPO appliquées et filtrées avec leur raison :
  sécurité, lien désactivé, GPO désactivée, vide), événements GroupPolicy, échanges LDAP/SMB visibles
  en mode Simulation.
- PowerShell : `New-GPO`, `Get-GPO`, `Rename-GPO`, `Remove-GPO`, `New-GPLink`, `Set-GPLink`,
  `Remove-GPLink`, `Get-GPInheritance`, `Set-GPInheritance`, `Get-GPPermission`, `Set-GPPermission`,
  `Invoke-GPUpdate`.

![Console Gestion des stratégies de groupe](docs/captures/gpo/1-console-heritage.webp)

## Fichiers, partages et NTFS

- Volume `C:` simulé sur chaque serveur : **Explorateur de fichiers** (dossiers, fichiers, lecteurs
  réseau), `dir`, `mkdir`, `rmdir`, `del`, `cd`, `Get-ChildItem`, `New-Item`, `Remove-Item`.
- Autorisations **NTFS** explicites et héritées (onglet Sécurité, `icacls`, `Get-Acl`), désactivation
  de l'héritage (conversion ou suppression), ordre canonique : refus explicite prioritaire.
- **Partages SMB** : Partage avancé, assistant Nouveau partage du Gestionnaire de serveur,
  `New-SmbShare`, `Grant/Revoke/Block-SmbShareAccess`, `net share`, partages administratifs (`C$`…).
- **Accès effectif** : droits d'un utilisateur ou d'un groupe, avec ce qui les limite (partage ou NTFS) ;
  accès réseau = le plus restrictif des deux.
- Depuis un poste : `\\serveur\partage` dans l'Explorateur, **Connecter un lecteur réseau**, `net use`,
  `net view`, erreurs réalistes (53, 67, 5), échanges SMB visibles en mode Simulation ; papier peint
  de stratégie lu sur un partage.

![Accès effectif au travers d'un partage](docs/captures/fichiers/2-acces-effectif.webp)
