# Journal des milestones v2.1 → v2.4

Suivi de la réalisation de la roadmap (`ROADMAP.md`), une issue = une branche `feat/<num>-<slug>` = une PR.
Ce journal permet à une nouvelle session de reprendre le travail là où il s'est arrêté.

## Conventions retenues

- **Format .slab** : une seule version de format par milestone. La première issue qui modifie le format
  incrémente `CURRENT_SCHEMA_VERSION` et écrit `fixtures/vN.slab` ; les issues suivantes du même milestone
  ajoutent des champs avec valeurs par défaut (le fichier de référence de la version reste valable).
  v2.1 → format 5.
- **Fidélité** : un comportement de Windows Server non sourcé est noté dans `docs/fidelite.md` (« à vérifier »).
- **Fin de milestone** : `CHANGELOG.md`, version de `package.json`, tag `vX.Y.0` poussé par Gary.

## v2.1 — Nouveaux rôles serveur

| Issue | Sujet                    | Branche        | PR  | État     |
| ----- | ------------------------ | -------------- | --- | -------- |
| #15   | Rôle WSUS                | `feat/15-wsus` |     | en cours |
| #16   | Rôle IIS                 |                |     | à faire  |
| #17   | Rôle RDS                 |                |     | à faire  |
| #18   | Rôle Hyper-V             |                |     | à faire  |
| #19   | Rôle AD CS               |                |     | à faire  |
| #20   | Rôle DFS                 |                |     | à faire  |
| #21   | Sauvegarde, corbeille AD |                |     | à faire  |

### #15 WSUS

- Moteur : `src/engine/roles/wsus/` (catalogue fictif KB91xxxxx, post-installation, synchronisation,
  classifications, groupes, ciblage serveur/client, approbations, refus) ; client : `wsusClientStatus`
  (stratégie appliquée → résolution DNS → échange HTTP 8530 tracé → groupe → mises à jour approuvées).
- GPO : « Spécifier l'emplacement intranet du service de mise à jour Microsoft » et « Autoriser le ciblage
  côté client » (Composants Windows > Windows Update). Protocole `HTTP` ajouté aux traces.
- Cmdlets : Get-WsusServer, Get-WsusClassification, Set-WsusClassification, Get-WsusUpdate,
  Approve-WsusUpdate, Deny-WsusUpdate, Get-WsusComputer, Add-WsusComputer.
- Interface : console « Services WSUS » (wsus.msc), page Windows Update des postes (ms-settings:windowsupdate).
- Lab `lab-06-wsus`, critères `wsusSynchronized`, `wsusApproval`, `wsusComputerGroup`, `wsusClientUpdate`.

### #16 IIS

- Système de base : magasin de certificats des ordinateurs (`host.certificates`, Personnel et Root),
  `New-SelfSignedCertificate`, confiance par la chaîne (`services/certificates.ts`) — réutilisé par AD CS (#19).
- Contrat des rôles : crochet `onInstall` (préparation du serveur : `C:\inetpub\wwwroot\iisstart.htm`).
- Moteur : `roles/iis/` (sites, liaisons IP/port/en-tête d'hôte, certificat SSL, conflits de liaison) et
  client HTTP `httpGet` (DNS avec CNAME, TCP tracé, choix du site comme http.sys, document par défaut,
  403.14, 404.0, 400 nom d'hôte invalide, connexion refusée, avertissements de certificat).
- Cmdlets WebAdministration (Get/New/Remove/Start/Stop-Website, Get/New/Remove-WebBinding) et
  Invoke-WebRequest (alias iwr, curl, wget) ; console « Gestionnaire IIS » (inetmgr), Navigateur Web.
- Lab `lab-07-iis`, critères `iisSite` et `httpResponse`.

### #17 RDS

- Système de base : paramètre « Autoriser les connexions à distance » et groupe local Utilisateurs du
  Bureau à distance (`host.remoteDesktop`), sessions distantes (`host.remoteSessions`), protocole `RDP`
  dans les traces ; onglet « Utilisation à distance » des Propriétés système.
- Moteur : `roles/rds/` (déploiement à serveur unique : collections, groupes d'utilisateurs — Utilisateurs
  du domaine par défaut —, RemoteApp) et `rdpConnect` (DNS, TCP 3389 tracé, authentification,
  autorisation : administrateurs, groupes de la collection sur un hôte de session, sinon groupe local ;
  évènements 4624 / 4625 de type 10).
- Cmdlets RemoteDesktop (New/Get/Remove-RDSessionCollection, Set-RDSessionCollectionConfiguration,
  New/Get/Remove-RDRemoteApp, Get-RDUserSession) et Add/Remove/Get-LocalGroupMember (groupe
  Utilisateurs du Bureau à distance) ; console « Services Bureau à distance », Connexion Bureau à distance (mstsc).
- Lab `lab-08-rds`, critères `rdsCollection` et `rdpSession`.

### #18 Hyper-V

- Modèle (premier cas d'équipements imbriqués) : une VM est un serveur ou un poste du lab avec
  `hostedBy` = l'hôte ; un commutateur virtuel est un switch hébergé dont les ports sont créés à la
  demande ; les liaisons VM ↔ commutateur sont des câbles `virtual` (pointillés sur le canvas).
  Commutateur externe : la carte physique de l'hôte devient un pont (`bridge`, sans adresse IP) et sa
  configuration IP passe sur `vEthernet (Nom)` ; `l2Segment` traverse le pont.
- Garde-fous de topologie : pas de câble vers une VM ou un commutateur virtuel, pas de suppression
  directe (Gestionnaire Hyper-V) ; supprimer l'hôte supprime ses équipements virtuels ; éteindre l'hôte
  arrête ses VM.
- Moteur `roles/hyperv/` : New/Remove-VMSwitch, New/Remove/Start/Stop/Set-VM, Get-VM, cartes réseau
  (Get/Add/Connect/Disconnect-VMNetworkAdapter), MAC 00-15-5D ; critères `vmSwitch`, `virtualMachine`
  et option `success: false` du critère `ping` (isolement) ; lab `lab-09-hyperv`.
- Format .slab : champs `hostedBy`, `virtual`, `bridge` avec valeurs par défaut (format 5 du milestone).

### #19 AD CS

- Contrat des rôles : crochet `onComputerPolicy` appelé au traitement de la stratégie ordinateur d'un
  membre du domaine (démarrage, gpupdate).
- Moteur `roles/adcs/` : autorité racine d'entreprise (nom par défaut `LAB-SRV1-CA`, certificat d'AC
  5 ans), modèles publiés par défaut, demande/émission (modèles Ordinateur et Serveur Web), révocation
  (motifs de certutil) ; côté client : certificat racine ajouté au magasin Root des membres, inscription
  automatique (paramètre GPO « Client des services de certificats – Inscription automatique »).
- HTTPS (IIS) : certificat révoqué signalé par le navigateur ; Gestionnaire IIS « Créer un certificat de domaine ».
- Cmdlets Install-AdcsCertificationAuthority, Get/Add/Remove-CATemplate, Get-Certificate ; outil certutil
  (-revoke, -crl, -pulse, -store) ; console « Autorité de certification » ; critères `enterpriseCa`,
  `caTemplate`, `certificate` ; lab `lab-10-adcs`.
- Critères : valeurs par défaut (`success`, `status`, `opened`, `received`) lues de façon robuste hors zod.
