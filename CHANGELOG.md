# Journal des modifications

Toutes les évolutions notables de ServerLab sont consignées ici.
Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) · versions : [SemVer](https://semver.org/lang/fr/).
La planification des versions suivantes est dans [ROADMAP.md](ROADMAP.md).

## [Non publié]

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

[Non publié]: https://github.com/tamalou25/packetracer-windows/compare/v2.0.1...HEAD
[2.0.1]: https://github.com/tamalou25/packetracer-windows/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/tamalou25/packetracer-windows/compare/dc9b76c...v2.0.0
[1.0.0]: https://github.com/tamalou25/packetracer-windows/compare/v0.1.1...dc9b76c
[0.1.1]: https://github.com/tamalou25/packetracer-windows/releases/tag/v0.1.1
