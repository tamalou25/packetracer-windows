# Journal des modifications

Toutes les évolutions notables de ServerLab sont consignées ici.
Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) · versions : [SemVer](https://semver.org/lang/fr/).
La planification des versions suivantes est dans [ROADMAP.md](ROADMAP.md).

## [Non publié]

## [2.2.0] — 2026-10-07

Milestone « v2.2 — Réseau d'entreprise » de la roadmap. Format `.slab` 6 (les labs 2.1 s'ouvrent ;
une version 2.1 refuse les labs 2.2). Écarts connus avec Windows Server : `docs/fidelite.md` (F53 à F86).

### Ajouté

- **VLAN** : base VLAN des switchs, ports d'accès et trunk (VLAN natif, VLAN autorisés), sous-interfaces
  de routeur (router-on-a-stick), en-tête 802.1Q visible en mode Simulation (#22).
- **Relais DHCP** : `ip helper-address` sur les interfaces de routeur, étendue choisie d'après le champ
  giaddr, échange relayé tracé (#23).
- **Pare-feu Windows Defender** : profils domaine/privé/public, règles prédéfinies des rôles, règles
  locales et par GPO, console `wf.msc`, cmdlets NetSecurity et `netsh advfirewall` ; paquets bloqués
  expliqués en Simulation (#24).
- **Accès à distance (RRAS)** : NAT vers Internet (traduction expliquée en Simulation), serveur VPN SSTP
  avec pool d'adresses, client VPN (Paramètres › VPN, `Add-VpnConnection`, `rasdial`) (#25).
- **NPS / RADIUS** : clients RADIUS, stratégies réseau par groupe AD, authentification RADIUS des clients
  VPN, journal Sécurité 6272 / 6273, console `nps.msc` (#26).
- **Multi-sites AD** : sites, sous-réseaux et liens de sites (`dssite.msc`), contrôleur supplémentaire
  (`Install-ADDSDomainController`), réplication (`repadmin`), rôles FSMO (`netdom query fsmo`, transfert,
  prise de force), authentification auprès du contrôleur du site du client (#27).
- Six nouveaux labs (13 à 18), un par fonctionnalité.

### Corrigé

- `$env:LOGONSERVER` désigne le contrôleur qui a authentifié la session (et non le nom du domaine).
- Événement RemoteAccess 20271 et message de l'erreur VPN 691 conformes au texte de Windows.
- Résolution DNS insensible à la casse des noms.

## [2.1.0] — 2026-10-06

Milestone « v2.1 — Nouveaux rôles serveur » de la roadmap. Format `.slab` 5 (les labs 2.0 s'ouvrent ;
une version 2.0 refuse les labs 2.1). Écarts connus avec Windows Server : `docs/fidelite.md` (F23 à F52).

### Ajouté

- **WSUS** : post-installation, synchronisation d'un catalogue fictif, classifications, groupes d'ordinateurs,
  approbations ; ciblage par GPO (Windows Update), client « Paramètres > Windows Update » (#15).
- **IIS** : sites, liaisons HTTP/HTTPS, document par défaut, certificats auto-signés, navigateur simulé avec
  erreurs 403/404 et avertissements TLS (#16).
- **Services Bureau à distance** : collections, RemoteApp, connexion Bureau à distance (mstsc), groupe
  Utilisateurs du Bureau à distance, journaux 4624/4625 de type 10 (#17).
- **Hyper-V** : commutateurs virtuels (externe, interne, privé), machines virtuelles visibles sur le canevas,
  démarrage/arrêt, cartes réseau des VM (#18).
- **AD CS** : autorité racine d'entreprise, modèles, demandes, révocation et liste de révocation,
  inscription automatique par GPO, `certutil`, certificats de domaine pour IIS (#19).
- **DFS** : espaces de noms de domaine (dossiers, cibles, bascule), réplication DFSR entre serveurs (#20).
- **Sauvegarde Windows Server** (planification, sauvegarde unique, récupération, `wbadmin`) et **Corbeille
  Active Directory** (restauration avec attributs et groupes, Centre d'administration Active Directory) (#21).
- Sept nouveaux labs (6 à 12), un par rôle.

## [2.0.1] — 2026-10-06

Version de stabilisation de la 2.0.0 : corrections uniquement, aucune fonctionnalité nouvelle.
Détail de la démarche dans `docs/stabilisation.md` ; écarts avec Windows Server dans `docs/fidelite.md`.

### Corrigé

- Console PowerShell : une expression régulière invalide (`-match '('`, `-notmatch`) affiche une
  erreur au lieu de bloquer la console (#54).
- `Get-Command -Name` et `Get-WindowsFeature -Name` suivent les jokers PowerShell (`*`, `?`) ; un
  caractère spécial comme `(` ne bloque plus la console (#56).
- `-in`, `-notin`, `-contains` et `-notcontains` acceptent une liste (`'a','b'`) dans `Where-Object`
  et les filtres (#55).
- `Get-ADUser -Properties` affiche les propriétés demandées, `*` pour toutes (#69).
- `net share` signale un compte inconnu par l'erreur système 1332 (#53).
- GPMC : l'entrée d'un compte supprimé peut être retirée du filtrage de sécurité (#61).
- Onglet Sécurité NTFS : l'entrée d'un compte supprimé peut être retirée (#62).
- Fichiers : noms réservés (`CON`, `NUL.txt`, `COM1`…) refusés ; points et espaces finaux retirés,
  `Data.` désigne `Data` (#63).
- Fichier `.slab` ou lab invalide : message d'erreur entièrement en français (#67).

### Modifié

- Tests : chaque commande, cmdlet et outil de console du moteur est exercé ; équivalence interface ⇔
  PowerShell ⇔ cmd ; réouverture `.slab` après chaque commande ; couverture du moteur mesurée par
  `npm run test:coverage` (lignes : 78 % → 90 %).

## [2.0.0] — 2026-10-06

Milestone « v1.1 — Consolider » de la roadmap, publié sous le numéro 2.0.0 : nouvelle
architecture du moteur, ergonomie et premier lancement guidé.

### Ajouté

- Écran d'accueil au lancement : labs récents (nom, dossier, date ; fichier introuvable signalé
  et retirable), Nouveau lab, Ouvrir…, labs fournis avec difficulté et durée ; Fichier > Accueil.
- Tutoriel interactif « premier ping » : placer un serveur et un poste, câbler, adresser, pinger ;
  zones mises en évidence, chaque étape validée par l'état réel du lab ; Aide > Tutoriel interactif.
- Annuler / rétablir sur tout le journal de commandes (Ctrl+Z / Ctrl+Y), libellés dans le menu
  Édition, aussi depuis les consoles.
- Aide > Signaler un bug… : issue GitHub préremplie (version, système, Electron), sans donnée du
  lab ni donnée personnelle ; seule cette adresse peut être ouverte (liste blanche).
- Thème « Système » (par défaut) qui suit l'OS en direct ; Affichage > Thème.
- Liste unique des raccourcis clavier (menus et Aide > Raccourcis clavier).

### Modifié

- Rôles serveur (DHCP, DNS, AD DS, GPO, fichiers) regroupés en modules déclarés dans un registre
  unique ; format `.slab` v4 (migration automatique des anciens fichiers).
- Toute modification du lab passe par des commandes nommées (dispatch, journal, rejeu).
- Topologie de 100 équipements fluide (caches par réseau, tâches de fond incrémentales, rendus
  ciblés).
- Logique métier des fenêtres déplacée dans le moteur.

### Sécurité

- Tout fichier importé est validé par un schéma zod ; un fichier `.slab` de référence par version
  du format garantit l'ouverture des anciens labs.
- Adresses externes ouvertes uniquement par le process principal, après liste blanche.

## [1.0.0] — 2026-10-05

Première version stable : mêmes fonctionnalités que la 0.1.1, numérotation alignée sur la roadmap.

### Ajouté

- Roadmap v1.1 → v5.0 (`ROADMAP.md`), milestones, labels et issues synchronisés depuis
  `.github/roadmap/roadmap.json` par le workflow « Roadmap sync ».
- Règles de travail (une issue = une branche = une PR) dans `CLAUDE.md`.

### Modifié

- Actions GitHub passées à Node 24 (`checkout@v5`, `setup-node@v5`, `upload-artifact@v5`).

## [0.1.1] — 2026-10-05

Première release publique (installeur Windows NSIS et AppImage Linux).

### Ajouté

- Topologie : palette, câblage port à port, voyants d'état, annuler/rétablir, fichiers `.slab`
  (récents, récupération automatique, association de fichiers).
- Moteur réseau : IPv4, routage statique, ARP, `ping` / `tracert`, mode Simulation pas à pas.
- Consoles PowerShell et Invite de commandes simulées en français, complétion Tab.
- Rôles : DHCP, DNS, AD DS (forêt, jonction, ouverture de session), stratégies de groupe (GPMC,
  éditeur, `gpupdate`, `gpresult`), fichiers et partages (NTFS, SMB, accès effectif).
- Bureau façon serveur : Gestionnaire de serveur, assistants, consoles MMC, Explorateur.
- Mode Labs : cinq labs vérifiables avec indices.
- Thèmes sombre et clair, interface compacte.
- Mises à jour automatiques (electron-updater) et workflow de release sur tag.

[Non publié]: https://github.com/tamalou25/packetracer-windows/compare/v2.1.0...HEAD
[2.1.0]: https://github.com/tamalou25/packetracer-windows/compare/v2.0.1...v2.1.0
[2.0.1]: https://github.com/tamalou25/packetracer-windows/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/tamalou25/packetracer-windows/compare/dc9b76c...v2.0.0
[1.0.0]: https://github.com/tamalou25/packetracer-windows/compare/v0.1.1...dc9b76c
[0.1.1]: https://github.com/tamalou25/packetracer-windows/releases/tag/v0.1.1
