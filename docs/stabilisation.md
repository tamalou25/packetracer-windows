# Journal de stabilisation 2.0.x

Mission : stabiliser la 2.0.0 (aucune nouvelle fonctionnalité). Milestones suivants et issue #38 gelés.
Une nouvelle session reprend **uniquement** à partir de ce fichier (lire aussi CLAUDE.md).

## État

| Clé              | Valeur                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------- |
| Étape en cours   | 1 — État des lieux (terminée, attente « OK étape 1 »)                                  |
| Base de travail  | `main` @ `ee85a79` (merge PR #51), `package.json` = 2.0.0                              |
| Prochaine action | Après « OK étape 1 » : étape 2 (preuve des acquis). En parallèle, Gary exécute A1 → A6 |

## Étapes

| #   | Étape                      | Statut                                            |
| --- | -------------------------- | ------------------------------------------------- |
| 0   | Hygiène du dépôt           | validée (OK le 2026-10-06), actions Gary en cours |
| 1   | État des lieux             | terminée, attente OK                              |
| 2   | Preuve des acquis 2.0.0    | à faire                                           |
| 3   | Couverture                 | à faire                                           |
| 4   | Chasse aux bugs par rôle   | à faire                                           |
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

## Bugs

| Issue | Titre | Branche | PR  | Statut |
| ----- | ----- | ------- | --- | ------ |

## Couverture

| Dossier `src/engine` | Avant | Après |
| -------------------- | ----- | ----- |

## Notes de reprise

- Ne jamais pousser sur `main`, taguer, publier ou supprimer sans accord explicite de Gary.
- Fin de chaque étape : tableau récapitulatif + mise à jour de ce fichier, puis attendre « OK étape N ».
