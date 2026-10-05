# Journal des modifications

Toutes les évolutions notables de ServerLab sont consignées ici.
Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) · versions : [SemVer](https://semver.org/lang/fr/).
La planification des versions suivantes est dans [ROADMAP.md](ROADMAP.md).

## [Non publié]

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

[Non publié]: https://github.com/tamalou25/packetracer-windows/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/tamalou25/packetracer-windows/compare/v0.1.1...v1.0.0
[0.1.1]: https://github.com/tamalou25/packetracer-windows/releases/tag/v0.1.1
