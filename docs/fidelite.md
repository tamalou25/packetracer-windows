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

| #   | Comportement simulé                                                                      | Doute                                                 | Source à consulter                                               |
| --- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| F1  | `Get-DnsServerZone` sur un DC : seule la zone du domaine                                 | zones `_msdcs`, `TrustAnchors`, inverses automatiques | Learn, _Get-DnsServerZone_ ; installation d'un DC (zones créées) |
| F2  | Zone inverse : SOA `hostmaster.srv1.lab.local.` (zone directe : `hostmaster.lab.local.`) | incohérence entre zones                               | Learn, _DNS Server SOA record_ (responsible person par défaut)   |
| F3  | Enregistrement statique : `Timestamp` = `0`                                              | colonne vide pour un enregistrement statique          | Learn, _Get-DnsServerResourceRecord_ (exemples)                  |
| F4  | `Get-NetIPConfiguration -Detailed` identique à la version courte                         | propriétés supplémentaires                            | Learn, _Get-NetIPConfiguration_                                  |
| F5  | `Rename-GPO` : `ModificationTime` inchangé                                               | date mise à jour                                      | Learn, _Rename-GPO_                                              |
| F6  | `echo x > fichier` (cmd) : redirection non gérée                                         | fichier créé (fonction absente du simulateur)         | Learn, _Using command redirection operators_                     |
| F7  | `dir /?` liste le dossier courant                                                        | aide de `dir`                                         | Learn, _dir_ (commandes Windows)                                 |
| F8  | Session refusée « mot de passe à changer » : aucun évènement journalisé                  | 4625 avec un sous-statut ?                            | Learn, _4625(F) An account failed to log on_                     |
| F9  | `net share` : nom ou chemin invalide → « Erreur système 2 »                              | code exact                                            | Learn, _System Error Codes_ ; documentation de `net share`       |
| F10 | `sAMAccountName` > 20 caractères : tronqué sans message                                  | `New-ADUser` refuse ?                                 | Learn, _SAM-Account-Name attribute_ ; _New-ADUser_               |
| F11 | `gpupdate /force` d'un utilisateur supprimé : « terminée sans erreur »                   | échec de la stratégie utilisateur                     | Learn, _gpupdate_                                                |
| F12 | Réservation DHCP sur une IP louée à une autre adresse MAC : acceptée                     | refus                                                 | Learn, _Add-DhcpServerv4Reservation_                             |
| F13 | Plages d'exclusion DHCP qui se chevauchent : acceptées                                   | refus                                                 | Learn, _Add-DhcpServerv4ExclusionRange_                          |
| F14 | Renouvellement DHCP sur étendue désactivée : bail perdu                                  | bail conservé jusqu'à expiration                      | Learn, _DHCP lease renewal_ / désactivation d'étendue            |
| F15 | Blocage de l'héritage refusé sur le nœud domaine                                         | possible dans la GPMC                                 | Learn, _Block inheritance_ (GPMC)                                |
| F16 | Entrées orphelines (GPO, NTFS, partage) affichées par l'identifiant interne              | SID inconnu (S-1-5-21-…)                              | Learn, _Security identifiers_                                    |
| F17 | Suppression du compte ordinateur d'un DC : acceptée                                      | refus ou nettoyage des métadonnées                    | Learn, _Clean up AD DS server metadata_                          |
| F18 | Erreur `-match` invalide : libellé et soulignement                                       | libellé exact de PowerShell 5.1                       | sortie réelle de PowerShell 5.1                                  |
| F19 | `Get-Command -Name` avec joker sans résultat : erreur                                    | aucune sortie, sans erreur                            | Learn, _Get-Command_ (Notes)                                     |
| F20 | `Get-ADDomain` : propriétés réduites                                                     | sortie complète du module ActiveDirectory             | Learn, _Get-ADDomain_                                            |
| F21 | Renouvellement DHCP avec nouvelle réservation pour la MAC : adresse inchangée            | NAK puis nouvelle adresse ?                           | Learn, _DHCP reservations_                                       |
| F22 | Réservation DHCP sans nom : acceptée                                                     | nom obligatoire dans la console                       | Learn, _Add-DhcpServerv4Reservation_ (paramètre Name)            |
