# Journal de stabilisation 2.0.x

Mission : stabiliser la 2.0.0 (aucune nouvelle fonctionnalité). Milestones suivants et issue #38 gelés.
Une nouvelle session reprend **uniquement** à partir de ce fichier (lire aussi CLAUDE.md).

## État

| Clé              | Valeur                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Étape en cours   | 4 — Chasse aux bugs par rôle (terminée, attente « OK étape 4 »)                                                                              |
| Base de travail  | `main` @ `ee85a79` (merge PR #51), `package.json` = 2.0.0                                                                                    |
| Prochaine action | Gary : relire et fusionner les PR #57 → #66 (une par bug, indépendantes, CI verte), A1 → A6. Après « OK étape 4 » : étape 5 (fichiers .slab) |

## Étapes

| #   | Étape                      | Statut                                            |
| --- | -------------------------- | ------------------------------------------------- |
| 0   | Hygiène du dépôt           | validée (OK le 2026-10-06), actions Gary en cours |
| 1   | État des lieux             | validée (OK le 2026-10-06)                        |
| 2   | Preuve des acquis 2.0.0    | validée (OK le 2026-10-06)                        |
| 3   | Couverture                 | validée (OK le 2026-10-06)                        |
| 4   | Chasse aux bugs par rôle   | terminée, attente OK                              |
| 5   | Fichiers .slab             | à faire                                           |
| 6   | Labs                       | à faire                                           |
| 7   | Mises à jour automatiques  | à faire                                           |
| 8   | Fidélité                   | à faire                                           |
| 9   | Release 2.0.1 (sur accord) | à faire                                           |

## Constats de l'étape 0 (2026-10-06)

| #   | Constat                                                                                                                                                                                                                                                                        | Gravité   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| C1  | Release GitHub « V2 » (tag `V2`, créée à la main) **sans aucun fichier** : ni installeur, ni `latest.yml`. `release.yml` filtre `tags: ['v*']` (sensible à la casse) → jamais déclenché.                                                                                       | Bloquant  |
| C2  | « V2 » est la release _latest_ : electron-updater lit `/releases/latest` → tag `V2` → `download/V2/latest.yml` = 404 (`ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`). **Une 0.1.1 installée ne peut plus se mettre à jour.**                                                            | Bloquant  |
| C3  | Tag annoté `v2.0.0` présent **en local uniquement** (sur `ee85a79`, même commit que `V2`), jamais poussé.                                                                                                                                                                      | Info      |
| C4  | Tag `v1.0.0` absent (local et distant) alors que CHANGELOG le référence (liens `compare/v1.0.0...v2.0.0` cassés).                                                                                                                                                              | Mineur    |
| C5  | Branche par défaut = `claude/bold-ride-9i62gy` (52 commits de retard sur `main`, entièrement fusionnée).                                                                                                                                                                       | Moyen     |
| C6  | Roadmap : le milestone « v2.0 » désigne les nouveaux rôles alors que 2.0.0 = milestone v1.1.                                                                                                                                                                                   | Moyen     |
| C7  | `roadmap-sync` associe les milestones **par titre** et se déclenche sur un push de **n'importe quelle branche** touchant `.github/roadmap/**` : renommer dans le JSON sans renommer d'abord sur GitHub crée des milestones en double (dès le push de la branche, avant merge). | Piège     |
| C8  | Milestone `v2.0.x` (exigé pour les bugs) inexistant.                                                                                                                                                                                                                           | Prérequis |

## Décisions demandées à Gary (étape 0)

- **D1** Branche par défaut → `main`.
- **D2** Release/tag 2.0.0 conformes (voir proposition dans la réponse de l'étape 0).
- **D3** Renumérotation de la roadmap.
- **D4** Suppression des branches fusionnées.
- **D5** Création du milestone `v2.0.x` (UI GitHub ou `roadmap.json`).

## Décisions prises

| Date       | Décision                                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| 2026-10-06 | D2 = A : supprimer release + tag `V2`, puis pousser le tag `v2.0.0` → `release.yml` publie installeurs + `latest.yml`. |
| 2026-10-06 | D3 = A : milestones renumérotés en mineures : rôles v2.1, réseau v2.2, cyber v2.3, pédagogie v2.4.                     |
| 2026-10-06 | Tag `v1.0.0` non créé (publierait une 1.0.0 « latest ») : liens du CHANGELOG corrigés avec la 2.0.1.                   |

### Actions de Gary (étape 0) — ordre imposé par C7

| #   | Action (interface GitHub)                                                                                  | Fait |
| --- | ---------------------------------------------------------------------------------------------------------- | ---- |
| A1  | Settings > Branches : branche par défaut → `main`                                                          | ☐    |
| A2  | Milestones : renommer v2.0 → v2.1, v3.0 → v2.2, v4.0 → v2.3, v5.0 → v2.4 (numéros 2 → 5 inchangés)         | ☐    |
| A3  | Créer le milestone `v2.0.x` (bugs de stabilisation)                                                        | ☐    |
| A4  | Supprimer la release « V2 » puis le tag `V2`                                                               | ☐    |
| A5  | Pousser `v2.0.0` (moi sur accord explicite, ou Gary) → vérifier release « ServerLab 2.0.0 » + `latest.yml` | ☐    |
| A6  | Supprimer les branches fusionnées (liste D4) ; `claude/bold-ride-9i62gy` après merge de la PR #52          | ☐    |

Après A2 : PR `docs` alignant `roadmap.json`, `ROADMAP.md`, `CLAUDE.md` sur la nouvelle numérotation (à faire par moi).

## Étape 1 — État des lieux (2026-10-06, `main` @ `ee85a79`)

| Commande                       | Résultat | Erreurs | Avertissements                                                                                                                                        |
| ------------------------------ | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                       | ✅       | 0       | 5 paquets dépréciés (transitifs) ; 8 vulnérabilités modérées, **toutes en dev** (chaîne electron-builder → `sprintf-js`) ; `npm audit --omit=dev` = 0 |
| `npm run lint`                 | ✅       | 0       | 0                                                                                                                                                     |
| `npm run typecheck`            | ✅       | 0       | 0                                                                                                                                                     |
| `npm test`                     | ✅       | 0       | 265 réussis, 3 ignorés = `runIf` des scripts `perf:measure` et `fixture:slab` (voulu)                                                                 |
| `xvfb-run -a npm run test:e2e` | ✅       | 0       | 31/31 en 1,9 min ; bundle renderer 2,0 Mo en un seul bloc (point déjà connu de la roadmap)                                                            |

## Étape 2 — Preuve des acquis « Consolider » (ROADMAP.md)

Fichiers : `E` = `tests/engine/…`, `S` = `tests/shared/…`, `P` = `tests/e2e/…`.

| Critère                                      | Statut | Preuve (fichier › test)                                                                                                                                                       |
| -------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rôles migrés dans `roles/<rôle>`             | ✅     | E `roles/registry.test.ts` › « déclare chaque rôle une fois… », « noms uniques… », « installer un rôle crée son état initial… »                                               |
| Un nouveau rôle ne touche plus au cœur       | ⚠️     | Structure + recette CLAUDE.md, aucun test (G1). Le cœur importe encore 6 fonctions de rôles (client DHCP, résolveur DNS, jonction, fichiers)                                  |
| Commande nommée via `dispatch` unique        | ✅     | E `commands/dispatch.test.ts` › « exécute la commande et produit une entrée… » ; store `lab.ts` : tout passe par `dispatchCommand` (relu)                                     |
| Inverse par patches immer                    | ✅     | E `commands/patches.test.ts` › « aller-retour sur une suite d'actions réelles » ; `dispatch.test.ts` › « annuler toutes les entrées… »                                        |
| Rejeu du journal = même état                 | ✅     | E `commands/dispatch.test.ts` › « rejouer les commandes depuis l'état initial redonne exactement le même état »                                                               |
| `.slab` : un fichier de référence/version    | ✅     | E `serialization/migrations.test.ts` › « un fichier de référence existe pour chaque version » (v1 → v4)                                                                       |
| Chacun s'ouvre et migre au format courant    | ✅     | E `migrations.test.ts` › « s'ouvre, migre… », « reste utilisable… », « se réenregistre au format courant sans perte »                                                         |
| Tout fichier importé validé zod              | ✅     | E `serialization/robustness.test.ts` (`.slab`, labs) ; S `persisted.test.ts` (`settings.json`, `recent.json`, IPC). Récupération auto = même `parseSlab`, flux non testé (G2) |
| Fichier corrompu = erreur claire, sans crash | ✅     | E `robustness.test.ts` › « tronqué n'importe où… », « caractères altérés : jamais d'exception », « trop volumineux… »                                                         |
| Annuler/rétablir canvas + libellés           | ✅     | P `undo.spec.ts` (ajout, glisser = 1 entrée, menu « Annuler : Déplacer PC1 ») ; E `history.test.ts` › « libellés du menu Édition… »                                           |
| Annuler/rétablir consoles                    | ✅     | P `undo.spec.ts` (New-NetIPAddress, Ctrl+Z, Maj+Ctrl+Z, menu Édition)                                                                                                         |
| Annuler/rétablir configurations GUI          | ⚠️     | Moteur ✅ (E `history.test.ts` › « tout annuler ramène l'état initial… ») ; aucun E2E depuis une fenêtre de configuration (G3)                                                |
| Thème « Système » par défaut                 | ✅     | P `theme.spec.ts` › « Thème Système par défaut : suit l'OS en direct… » ; S `persisted.test.ts`, `theme-shortcuts.test.ts`                                                    |
| Raccourcis documentés                        | ✅     | P `theme.spec.ts` › « Aide > Raccourcis clavier : tous les raccourcis du menu » ; S `theme-shortcuts.test.ts`                                                                 |
| Écran d'accueil (récents, nouveau, labs)     | ✅     | P `home.spec.ts` (3 tests) ; S `recent.test.ts`                                                                                                                               |
| Tutoriel : premier ping guidé                | ✅     | P `tutorial.spec.ts` › « parcours complet jusqu'au premier ping »                                                                                                             |
| Tutoriel : étapes validées par l'état réel   | ✅     | E `tutorial/first-ping.test.ts` (12 tests, dont « ping possible mais pas effectué : étape non validée »)                                                                      |
| Tutoriel désactivable                        | ✅     | P `tutorial.spec.ts` › « passer et désactiver ; relancer depuis Aide… » ; S `persisted.test.ts`                                                                               |
| Signaler un bug : issue préremplie           | ✅     | S `bug-report.test.ts` › « version, système et Electron ; étapes… » ; P `bug-report.spec.ts`                                                                                  |
| URL en liste blanche                         | ✅     | S `bug-report.test.ts` › « seule la création d'issue… », « tout le reste est refusé »                                                                                         |
| Performance : 100 équipements, mesuré        | ✅     | P `performance.spec.ts` (seuils, 0 rendu des autres nœuds) ; E `perf/large-lab.test.ts`, `roles/background.test.ts`, `topology/view.test.ts`                                  |
| Logique NTFS et ports dans le moteur         | ✅     | E `roles/ui-queries.test.ts` (7 tests) ; `NTFS_IMPLIES` dans `roles/files/acl.ts`, absent des composants (relu)                                                               |

Écarts avec les critères détaillés des issues v1.1 (hors tableau ROADMAP) :

- **G1** Aucun test ne prouve qu'un rôle s'ajoute sans toucher au cœur.
- **G2** Récupération automatique corrompue : parseur testé, flux `document.ts` non testé.
- **G3** Annuler une configuration faite dans une fenêtre GUI : pas d'E2E.
- **G4** « Journal des commandes consultable » : seuls les libellés Annuler / Rétablir du menu Édition sont visibles, aucune vue du journal. Fonctionnalité manquante → hors mission (gel), à consigner pour le milestone suivant.
- Zoom Ctrl+= / Ctrl+- : accélérateurs déclarés et testés en format, jamais pressés en E2E (molette et menu le sont).

## Bugs

| #   | Issue | Titre                                                                              | Gravité                    | Branche                     | PR  | Statut               |
| --- | ----- | ---------------------------------------------------------------------------------- | -------------------------- | --------------------------- | --- | -------------------- |
| B1  | #53   | `net share … /grant:Inconnu` : « Erreur système 2 » au lieu de 1332                | Mineure (fidélité sourcée) | `fix/53-net-share-1332`     | #60 | corrigé, PR en revue |
| B2  | #54   | `-match` / `-notmatch` regex invalide : exception non rattrapée                    | Haute (plantage console)   | `fix/54-regex-invalide`     | #57 | corrigé, PR en revue |
| B3  | #55   | `-in` / `-notin` / `-contains` : liste `'a','b'` refusée, opérateurs inutilisables | Moyenne                    | `fix/55-listes-expressions` | #59 | corrigé, PR en revue |
| B4  | #56   | `Get-Command` / `Get-WindowsFeature -Name` : joker non échappé, plantage sur `(`   | Haute (plantage console)   | `fix/56-joker-name`         | #58 | corrigé, PR en revue |

| B5 | #61 | GPMC : entrée orpheline du filtrage de sécurité impossible à retirer | Moyenne | `fix/61-filtre-gpo-orphelin` | #64 | corrigé, PR en revue |
| B6 | #62 | Onglet Sécurité NTFS : « Supprimer » échoue sur un compte supprimé | Moyenne | `fix/62-ntfs-entree-orpheline` | #65 | corrigé, PR en revue |
| B7 | #63 | Noms réservés (CON, NUL…) acceptés ; « Data. » distinct de « Data » | Mineure (fidélité sourcée) | `fix/63-noms-reserves` | #66 | corrigé, PR en revue |

Milestone `v2.0.x` absent (A3) : rattacher #53 → #56 et #61 → #63 dès sa création. Les PR partent de `main`
et sont indépendantes ; #57 et #59 modifient le même fichier (fonctions différentes, pas de conflit attendu).

## Couverture

Mesure : `npm run test:coverage` (v8, `src/engine/**`). Avant = `main` @ `ee85a79`.

| Métrique       | Avant  | Après  |
| -------------- | ------ | ------ |
| Lignes         | 78,5 % | 90,4 % |
| Instructions   | 75,5 % | 86,5 % |
| Fonctions      | 76,2 % | 92,5 % |
| Branches       | 63,6 % | 72,5 % |
| Tests (moteur) | 265    | 314    |
| Tests (E2E)    | 31     | 34     |

| Dossier (lignes) | Avant  | Après  |
| ---------------- | ------ | ------ |
| commands         | 73,0 % | 96,4 % |
| roles/adds       | 70,7 % | 88,9 % |
| roles/dhcp       | 75,0 % | 91,8 % |
| roles/dns        | 77,8 % | 89,6 % |
| roles/files      | 71,4 % | 89,5 % |
| roles/gpo        | 85,2 % | 90,4 % |
| shell/cmd        | 58,5 % | 96,2 % |
| shell/ps         | 72,6 % | 86,5 % |
| shell/tools      | 63,2 % | 90,3 % |
| autres dossiers  | ≥ 86 % | ≥ 86 % |

Tests ajoutés (étape 3) :

- `tests/engine/commands/catalog.test.ts` : les 68 commandes du catalogue via `dispatch` (succès, libellé FR,
  inverse exact) ; échoue si une commande est ajoutée sans test.
- `tests/engine/shell/cmdlets-roles.test.ts`, `cmdlets-core.test.ts`, `cmd-tools.test.ts`, `files-tools.test.ts`,
  `ps-expressions.test.ts` : 58 cmdlets et 5 outils cmd jamais exécutés jusque-là, équivalence GUI ⇔ PowerShell
  sur DHCP (exclusion, réservation) et Remove-Computer.
- `tests/engine/roles/boundaries.test.ts` : garde-fou G1 (dépendances cœur → rôle figées, aucun `case '<rôle>'`).
- `tests/e2e/recovery.spec.ts` (G2) et 2e test de `tests/e2e/undo.spec.ts` (G3).

Restant : branches à 72,5 % (cible 80 % atteinte en lignes, pas en branches). Points faibles : `shell/ps`
(66 %), `roles/files` et `roles/adds` (69 %).

## Étape 4 — Chasse aux bugs (2026-10-06)

Méthode : banc d'essai (scripts jetables, hors dépôt) exécutant des dizaines de cas limites par rôle via
`dispatch`, avec contrôle après chaque opération : rechargement `.slab` identique, aucune référence orpheline
(liaisons GPO, membres, parents, partages). Puis tests durables :

- `tests/engine/equivalence.test.ts` : même action par l'interface, PowerShell et cmd → même état (AD DS, DHCP,
  DNS, GPO, fichiers/partage/NTFS sur les trois chemins).
- `tests/engine/commands/catalog.test.ts` : en plus de l'inverse, chaque commande est enregistrée puis rouverte
  (`.slab`) et doit redonner exactement le même lab.

| Rôle                        | Cas limites essayés                                                                                                                                                | Résultat                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| AD DS                       | vides, doublons (casse), sam > 20, caractères interdits, cycles de groupes et d'OU, objets intégrés, suppression d'objets référencés, session d'un compte supprimé | B5 ; reste OK           |
| DHCP                        | plages invalides, réseau/diffusion, chevauchements, exclusions et réservations (doublons, hors plage, MAC), options, étendue supprimée avec baux, rôle désinstallé | OK                      |
| DNS                         | zones (vides, doublons, inverses), A/CNAME (conflits, boucles a→b→a et auto-référence), redirecteurs, suppressions                                                 | OK (boucles : SERVFAIL) |
| GPO                         | noms vides/doublons, liaisons doubles/hors OU, ordre, filtrage, paramètres hors bornes, suppression d'une GPO liée ou par défaut                                   | OK                      |
| Fichiers                    | noms invalides/réservés, doublons, `..`, racine, partages (vides, doublons, fichier, admin), refus aux Administrateurs, compte supprimé                            | B6, B7                  |
| Annuler / rétablir, `.slab` | inverse et réouverture vérifiés pour chacune des 68 commandes                                                                                                      | OK                      |
| GUI ⇔ PS ⇔ cmd              | 5 scénarios (AD, DHCP, DNS, GPO, fichiers)                                                                                                                         | OK                      |

## Points de fidélité relevés (pour l'étape 8, non corrigés)

| Comportement simulé                                                                 | Doute                                               |
| ----------------------------------------------------------------------------------- | --------------------------------------------------- |
| `Get-ADUser -Properties Description` n'affiche pas `Description`                    | `-Properties` ajoute les propriétés demandées       |
| `Get-DnsServerZone` sur un DC : seule `lab.local`                                   | zones `_msdcs`, `TrustAnchors`, zones inverses auto |
| Zone inverse : SOA `hostmaster.srv1.lab.local.` (directe : `hostmaster.lab.local.`) | incohérence entre zones                             |
| Enregistrement statique : `Timestamp` = `0`                                         | colonne vide pour un enregistrement statique        |
| `Get-NetIPConfiguration -Detailed` identique à la version courte                    | propriétés supplémentaires                          |
| `Rename-GPO` : `ModificationTime` inchangé                                          | date mise à jour                                    |
| `echo x > fichier` (cmd) : redirection non gérée, texte affiché                     | fichier créé (fonction absente → hors mission)      |
| `dir /?` liste le dossier courant                                                   | aide de `dir`                                       |
| Session refusée « mot de passe à changer » : aucun évènement journalisé             | 4625 attendu ?                                      |
| `net share` : nom ou chemin invalide → « Erreur système 2 »                         | code exact à vérifier                               |
| `sAMAccountName` > 20 caractères : tronqué sans message                             | New-ADUser refuse ?                                 |
| Ouverture de session après suppression du compte ordinateur : acceptée              | « La relation d'approbation… a échoué »             |
| `gpupdate /force` d'un utilisateur supprimé : « terminée sans erreur »              | échec de la stratégie utilisateur attendu           |
| Réservation DHCP sur une IP louée à une autre MAC : acceptée                        | refus attendu ?                                     |
| Plages d'exclusion DHCP qui se chevauchent : acceptées                              | refus attendu ?                                     |
| Renouvellement DHCP sur étendue désactivée : bail perdu                             | bail conservé jusqu'à expiration ?                  |
| Blocage de l'héritage refusé sur le domaine                                         | possible dans la GPMC (nœud domaine)                |
| Entrées orphelines (GPO, NTFS, partage) affichées par l'identifiant interne         | SID inconnu (S-1-5-21-…)                            |
| Suppression du compte ordinateur d'un DC : acceptée                                 | refus ou nettoyage des métadonnées                  |
| Erreur `-match` invalide : libellé et soulignement                                  | libellé exact de PowerShell 5.1                     |
| `Get-Command -Name` avec joker sans résultat : erreur                               | aucune sortie, sans erreur                          |

## Notes de reprise

- Ne jamais pousser sur `main`, taguer, publier ou supprimer sans accord explicite de Gary.
- Fin de chaque étape : tableau récapitulatif + mise à jour de ce fichier, puis attendre « OK étape N ».
