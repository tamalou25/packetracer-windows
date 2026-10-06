# Roadmap ServerLab

Versions prévues après la v1.0.0, avec leurs objectifs et critères d'acceptation. Le détail de
chaque fonctionnalité (critères à cocher) est dans son issue GitHub, rattachée au milestone de sa
version. Source unique : [`.github/roadmap/roadmap.json`](.github/roadmap/roadmap.json), synchronisé
avec GitHub par le workflow **Roadmap sync** (ne crée que ce qui manque).

| Version | Thème                                                         | Milestone                                                            |
| ------- | ------------------------------------------------------------- | -------------------------------------------------------------------- |
| v1.1    | Consolider (prérequis d'architecture, ergonomie, performance) | [v1.1](https://github.com/tamalou25/packetracer-windows/milestone/1) |
| v2.0    | Nouveaux rôles serveur                                        | [v2.0](https://github.com/tamalou25/packetracer-windows/milestone/2) |
| v3.0    | Réseau avancé                                                 | [v3.0](https://github.com/tamalou25/packetracer-windows/milestone/3) |
| v4.0    | Cybersécurité défensive                                       | [v4.0](https://github.com/tamalou25/packetracer-windows/milestone/4) |
| v5.0    | Pédagogie et communauté                                       | [v5.0](https://github.com/tamalou25/packetracer-windows/milestone/5) |

> Le milestone v1.1 est sorti sous le numéro de version **2.0.0** (choix de Gary) ; les milestones
> suivants seront numérotés à leur sortie.

Règles : un milestone ne commence qu'une fois le précédent terminé et validé ; une issue = une
branche `feat/<num>-<slug>` = une PR (`Closes #N`) ; fin de milestone = CHANGELOG, version, tag
`vX.Y.0` (voir [CLAUDE.md](CLAUDE.md)).

## v1.1 — Consolider

**Objectif** : rendre le moteur extensible avant d'ajouter des rôles, et finir l'ergonomie de base.

### Prérequis d'architecture (en premier)

| Fonctionnalité                  | Critère d'acceptation                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Modules de rôles (`RoleModule`) | DHCP, DNS, AD DS, GPO et Fichiers migrés dans `src/engine/roles/<rôle>` ; un nouveau rôle ne touche plus au cœur         |
| Pattern Command                 | Toute modification = commande nommée via un `dispatch` unique ; inverse par patches immer ; rejeu du journal = même état |
| Migrations `.slab`              | Un fichier de référence par version ; chacun s'ouvre et migre jusqu'à la version courante                                |
| Validation zod                  | Tout fichier importé est validé ; un fichier corrompu donne une erreur claire, jamais un plantage                        |

### Fonctionnalités

| Fonctionnalité                   | Critère d'acceptation                                               | Déjà fait (audit v1.0)              |
| -------------------------------- | ------------------------------------------------------------------- | ----------------------------------- |
| Annuler / rétablir               | Ctrl+Z / Ctrl+Y sur canvas, configs et consoles, avec libellés      | Pile de 100 instantanés, raccourcis |
| Thème, raccourcis, zoom, minimap | Thème « Système » par défaut, raccourcis documentés                 | Sombre/clair, zoom, minimap         |
| Écran d'accueil                  | Récents, nouveau lab, labs fournis                                  | —                                   |
| Tutoriel interactif              | Premier ping guidé, étapes validées par l'état réel, désactivable   | —                                   |
| Signaler un bug                  | Issue GitHub préremplie (version, OS, étapes), URL en liste blanche | —                                   |
| Performance                      | 100 équipements fluides, mesuré par un test                         | —                                   |
| Logique hors composants          | Règles NTFS et ports déplacées dans le moteur                       | Ajoutée par l'audit                 |

## v2.0 — Nouveaux rôles serveur

**Objectif** : couvrir les rôles d'infrastructure courants, chacun sous forme de `RoleModule`.

| Rôle       | À simuler                                                                 | Critère d'acceptation                                                        |
| ---------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| WSUS       | Synchro, classifications, groupes d'ordinateurs, approbations, GPO client | Un client ne reçoit que les MAJ approuvées pour son groupe                   |
| IIS        | Sites, liaisons (port, en-tête d'hôte), dossier racine, HTTPS             | `http://intranet.domaine.local` répond depuis un client après ajout du CNAME |
| RDS        | Hôte de session, groupe d'accès, RemoteApp                                | Seuls les membres autorisés ouvrent une session                              |
| Hyper-V    | VM imbriquées, commutateurs externe / interne / privé                     | Une VM sur commutateur privé ne joint pas le réseau physique                 |
| ADCS       | AC racine d'entreprise, modèles, inscription auto par GPO                 | Certificat IIS émis par l'AC interne, approuvé par les clients du domaine    |
| DFS        | Espaces de noms, groupes de réplication                                   | Un fichier créé sur un serveur apparaît sur l'autre                          |
| Sauvegarde | Planification, restauration, corbeille AD                                 | Un utilisateur AD supprimé est restaurable                                   |

## v3.0 — Réseau avancé

| Fonctionnalité                 | Critère d'acceptation                                        |
| ------------------------------ | ------------------------------------------------------------ |
| VLAN, trunk 802.1Q, inter-VLAN | Deux VLAN ne communiquent que via le routeur « on a stick »  |
| Relais DHCP                    | Un serveur DHCP sert plusieurs VLAN (helper-address)         |
| Pare-feu simulé                | Profils et règles avec effet réel sur ping et partages       |
| RRAS                           | NAT vers Internet et VPN simple fonctionnels                 |
| NPS / RADIUS                   | VPN autorisé uniquement pour un groupe AD                    |
| Multi-sites AD                 | Sites, liens, réplication entre DC, transfert des rôles FSMO |

## v4.0 — Cybersécurité (défensif)

| Fonctionnalité                | Critère d'acceptation                                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Mode Audit                    | Score de sécurité + recommandations (admins, expiration, partages, SMBv1, mots de passe, comptes inactifs, pare-feu) |
| Labs de durcissement          | Lab mal configuré → corrections → score validé                                                                       |
| Journaux de sécurité          | 4624, 4625, 4720, 4728, 4740, 4672 simulés et filtrables                                                             |
| Verrouillage et audit par GPO | Effet visible dans les journaux                                                                                      |
| Rapport PDF                   | Rapport d'audit exportable                                                                                           |

## v5.0 — Pédagogie et communauté

| Fonctionnalité             | Critère d'acceptation                                                       |
| -------------------------- | --------------------------------------------------------------------------- |
| Éditeur de labs            | Énoncé, topologie, critères sans code, indices progressifs                  |
| Mode examen                | Chronomètre, sans indices, note détaillée exportable                        |
| Bibliothèque communautaire | Index JSON dans un dépôt séparé, validation zod stricte, aucun code exécuté |
| Client Linux               | Poste Ubuntu simulé : `ip a`, `realm join`, accès SMB                       |
| Interface FR / EN          | i18n complète, aucune clé manquante                                         |
| Signature de code          | Procédure documentée, rien d'automatisé sans accord                         |

## Points d'attention (audit v1.0)

- Le dépôt est privé : mises à jour automatiques et bibliothèque communautaire exigent des
  releases ou un dépôt publics.
- Hyper-V (équipements imbriqués), VLAN (refonte du L2) et client Linux (nouveau type d'équipement
  et nouveau shell) sont les plus gros changements de modèle.
- Le bundle de l'interface tient en un seul bloc de 1,9 Mo ; les chaînes sont en français codé en dur.
