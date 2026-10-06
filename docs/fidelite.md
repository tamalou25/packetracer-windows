# Fidélité au vrai Windows Server

Comportements simulés qui s'écartent peut-être de Windows Server (relevés pendant la stabilisation 2.0.x).
Règle : on ne corrige que ce qui est **sourcé** (documentation Microsoft). Un point non sourcé reste ici,
avec la source à vérifier, jusqu'à ce qu'une source tranche.

Statuts : **corrigé** (PR liée) · **sourcé** (source trouvée, correction à planifier) · **à vérifier**
(aucune source trouvée : ne pas corriger).

Note : learn.microsoft.com n'était pas accessible depuis l'environnement de travail ; les sources citées
ont été trouvées par recherche (TechNet / Learn, pages archivées).

## Corrigés pendant la stabilisation

| Comportement simulé (avant)                                           | Source Microsoft                                                                                                | PR  |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --- |
| `net share … /grant:Inconnu` : « Erreur système 2 »                   | Learn, _System Error Codes (1300-1699)_ : `ERROR_NONE_MAPPED` = 1332                                            | #60 |
| `md C:\CON` accepté ; `Data.` distinct de `Data`                      | Learn, _Naming Files, Paths, and Namespaces_ ; _File path formats on Windows systems_ (Trim characters)         | #66 |
| `Get-Command` / `Get-WindowsFeature -Name` : `?` non joker, `.` joker | Learn, _about_Wildcards_                                                                                        | #58 |
| `-in` / `-notin` / `-contains` : liste `'a','b'` refusée              | Learn, _about_Comparison_Operators_ (Containment operators), _about_Operator_Precedence_                        | #59 |
| `Get-ADUser -Properties` ignoré                                       | [TechNet ee617241](https://technet.microsoft.com/library/ee617241.aspx) : propriétés ajoutées au jeu par défaut | #70 |

## Sourcés, correction à planifier (hors mission : comportement à ajouter)

| Comportement simulé                                                               | Comportement Windows                                                                           | Source                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session de domaine acceptée sur un poste dont le compte ordinateur a été supprimé | « La relation d'approbation entre cette station de travail et le domaine principal a échoué. » | [Learn, _Trust relationship between workstation and primary domain fails_](https://learn.microsoft.com/en-us/previous-versions/troubleshoot/windows-server/trust-relationship-between-workstation-domain-fail) |

## À vérifier (aucune source trouvée : ne pas corriger)

| #   | Comportement simulé                                                                                   | Doute                                                 | Source à consulter                                                    |
| --- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------- |
| F1  | `Get-DnsServerZone` sur un DC : seule la zone du domaine                                              | zones `_msdcs`, `TrustAnchors`, inverses automatiques | Learn, _Get-DnsServerZone_ ; installation d'un DC (zones créées)      |
| F2  | Zone inverse : SOA `hostmaster.srv1.lab.local.` (zone directe : `hostmaster.lab.local.`)              | incohérence entre zones                               | Learn, _DNS Server SOA record_ (responsible person par défaut)        |
| F3  | Enregistrement statique : `Timestamp` = `0`                                                           | colonne vide pour un enregistrement statique          | Learn, _Get-DnsServerResourceRecord_ (exemples)                       |
| F4  | `Get-NetIPConfiguration -Detailed` identique à la version courte                                      | propriétés supplémentaires                            | Learn, _Get-NetIPConfiguration_                                       |
| F5  | `Rename-GPO` : `ModificationTime` inchangé                                                            | date mise à jour                                      | Learn, _Rename-GPO_                                                   |
| F6  | `echo x > fichier` (cmd) : redirection non gérée                                                      | fichier créé (fonction absente du simulateur)         | Learn, _Using command redirection operators_                          |
| F7  | `dir /?` liste le dossier courant                                                                     | aide de `dir`                                         | Learn, _dir_ (commandes Windows)                                      |
| F8  | Session refusée « mot de passe à changer » : aucun évènement journalisé                               | 4625 avec un sous-statut ?                            | Learn, _4625(F) An account failed to log on_                          |
| F9  | `net share` : nom ou chemin invalide → « Erreur système 2 »                                           | code exact                                            | Learn, _System Error Codes_ ; documentation de `net share`            |
| F10 | `sAMAccountName` > 20 caractères : tronqué sans message                                               | `New-ADUser` refuse ?                                 | Learn, _SAM-Account-Name attribute_ ; _New-ADUser_                    |
| F11 | `gpupdate /force` d'un utilisateur supprimé : « terminée sans erreur »                                | échec de la stratégie utilisateur                     | Learn, _gpupdate_                                                     |
| F12 | Réservation DHCP sur une IP louée à une autre adresse MAC : acceptée                                  | refus                                                 | Learn, _Add-DhcpServerv4Reservation_                                  |
| F13 | Plages d'exclusion DHCP qui se chevauchent : acceptées                                                | refus                                                 | Learn, _Add-DhcpServerv4ExclusionRange_                               |
| F14 | Renouvellement DHCP sur étendue désactivée : bail perdu                                               | bail conservé jusqu'à expiration                      | Learn, _DHCP lease renewal_ / désactivation d'étendue                 |
| F15 | Blocage de l'héritage refusé sur le nœud domaine                                                      | possible dans la GPMC                                 | Learn, _Block inheritance_ (GPMC)                                     |
| F16 | Entrées orphelines (GPO, NTFS, partage) affichées par l'identifiant interne                           | SID inconnu (S-1-5-21-…)                              | Learn, _Security identifiers_                                         |
| F17 | Suppression du compte ordinateur d'un DC : acceptée                                                   | refus ou nettoyage des métadonnées                    | Learn, _Clean up AD DS server metadata_                               |
| F18 | Erreur `-match` invalide : libellé et soulignement                                                    | libellé exact de PowerShell 5.1                       | sortie réelle de PowerShell 5.1                                       |
| F19 | `Get-Command -Name` avec joker sans résultat : erreur                                                 | aucune sortie, sans erreur                            | Learn, _Get-Command_ (Notes)                                          |
| F20 | `Get-ADDomain` : propriétés réduites                                                                  | sortie complète du module ActiveDirectory             | Learn, _Get-ADDomain_                                                 |
| F21 | Renouvellement DHCP avec nouvelle réservation pour la MAC : adresse inchangée                         | NAK puis nouvelle adresse ?                           | Learn, _DHCP reservations_                                            |
| F22 | Réservation DHCP sans nom : acceptée                                                                  | nom obligatoire dans la console                       | Learn, _Add-DhcpServerv4Reservation_ (paramètre Name)                 |
| F23 | WSUS : classifications synchronisées par défaut = critiques + sécurité                                | choix par défaut de l'assistant de configuration      | Learn, _Configure WSUS_ (Choose Classifications)                      |
| F24 | WSUS : un ordinateur n'apparaît dans la console que tant qu'il joint le serveur                       | conservé après son premier rapport                    | Learn, _Manage WSUS computers_                                        |
| F25 | `Approve-WsusUpdate -Action` : Install et NotApproved seulement                                       | Uninstall et All acceptés                             | Learn, _Approve-WsusUpdate_                                           |
| F26 | Formats de sortie de `Get-WsusUpdate`, `Get-WsusComputer`, `Get-WsusClassification`                   | colonnes et libellés exacts                           | sortie réelle du module UpdateServices                                |
| F27 | IIS : site créé avec un dossier racine inexistant : refusé                                            | IIS accepte le chemin, l'erreur survient à la requête | Learn, _New-Website_ ; erreur IIS correspondante                      |
| F28 | IIS : seul site d'un port arrêté → connexion refusée (aucune réponse HTTP)                            | réponse 404 ou 503 de http.sys                        | Learn, _HTTP.sys_ / comportement d'un site arrêté                     |
| F29 | Module WebAdministration disponible dès l'installation de Web-Server                                  | fonctionnalité Web-Scripting-Tools requise ?          | Learn, _WebAdministration module_                                     |
| F30 | `New-SelfSignedCertificate` sans `-CertStoreLocation` : refusé                                        | magasin Cert:\CurrentUser\My par défaut               | Learn, _New-SelfSignedCertificate_ (non simulé : magasin utilisateur) |
| F31 | RDS : déploiement à serveur unique, sans `New-RDSessionDeployment`                                    | cmdlets RemoteDesktop exigent un déploiement          | Learn, _New-RDSessionDeployment_                                      |
| F32 | RDS : les administrateurs se connectent même hors des groupes de la collection                        | droits RDP-Tcp d'un hôte de session                   | Learn, _Configure RDS collection user groups_                         |
| F33 | Échec RDP (identifiants) journalisé en 4625 de type 10                                                | type 3 avec l'authentification réseau (NLA)           | Learn, _4625(F) An account failed to log on_                          |
| F34 | `Add-LocalGroupMember` limité au groupe Utilisateurs du Bureau à distance                             | tous les groupes locaux                               | (limite du simulateur)                                                |
| F35 | Hyper-V : installation sans redémarrage                                                               | redémarrage obligatoire                               | Learn, _Install the Hyper-V role on Windows Server_                   |
| F36 | Nom de VM soumis aux règles de nom d'ordinateur (VM = ordinateur invité)                              | nom de VM libre, distinct du nom de l'invité          | (limite du simulateur)                                                |
| F37 | `Remove-VM` refusé sur une VM en cours d'exécution                                                    | comportement exact (arrêt forcé ?)                    | Learn, _Remove-VM_                                                    |
| F38 | Carte vEthernet d'un commutateur externe : nouvelle adresse MAC                                       | reprend l'adresse MAC de la carte physique            | Learn, _Create a virtual switch for Hyper-V_                          |
| F39 | AD CS : seule l'autorité racine d'entreprise est simulée                                              | autonome, secondaire                                  | Learn, _Install-AdcsCertificationAuthority_                           |
| F40 | Demande de certificat : émission immédiate, sans contrôle des autorisations du modèle                 | droits Inscrire du modèle, approbation en attente     | Learn, _Certificate template permissions_                             |
| F41 | Liste de révocation consultée instantanément par les clients                                          | publication et cache de la CRL (validité, delta)      | Learn, _Configure CRL distribution points_                            |
| F42 | Messages de `certutil` (« La commande s’est terminée correctement. »)                                 | libellés exacts de la version française               | sortie réelle de certutil                                             |
| F43 | DFSR : réplication en maille complète, sans connexions ni planification                               | connexions (Add-DfsrConnection), planification, RDC   | Learn, _DFS Replication overview_                                     |
| F44 | DFSR : élément supprimé puis réapparu sur un membre resté hors ligne : recréé                         | pierres tombales (tombstones) : suppression conservée | Learn, _DFSR tombstones_                                              |
| F45 | DFSR : réplication initiale sans dossier PreExisting                                                  | fichiers des membres non principaux déplacés          | Learn, _DFSR initial sync / PreExisting_                              |
| F46 | Groupes de réplication conservés sur le serveur qui les crée (pas dans AD)                            | configuration stockée dans Active Directory           | Learn, _DFS Replication: configuration in AD_                         |
| F47 | Sauvegarde planifiée : jamais exécutée automatiquement (aucune horloge murale)                        | exécution quotidienne à l'heure prévue                | Learn, _wbadmin enable backup_                                        |
| F48 | État du système sauvegardé mais non restaurable (restauration d'un DC non simulée)                    | wbadmin start systemstaterecovery                     | Learn, _wbadmin start systemstaterecovery_                            |
| F49 | Destination de sauvegarde : volume ou partage non vérifié (aucun disque simulé)                       | disque dédié formaté par l'assistant                  | Learn, _Windows Server Backup_ (destinations)                         |
| F50 | `Get-ADObject` simulé pour les objets supprimés seulement ; filtre `Name -like`, `SamAccountName -eq` | requêtes LDAP complètes                               | Learn, _Get-ADObject_                                                 |
| F51 | Corbeille AD activée par domaine (forêt à un domaine), sans durée de vie des objets supprimés         | 180 jours (msDS-deletedObjectLifetime)                | Learn, _AD Recycle Bin step-by-step_                                  |
| F52 | Centre d'administration Active Directory limité à la Corbeille                                        | console complète (objets, PSO, contrôle d'accès)      | Learn, _Active Directory Administrative Center_                       |
