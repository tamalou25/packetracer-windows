# CLAUDE.md — ServerLab

Simulateur desktop d'administration de serveurs (AD DS, DNS, DHCP, GPO, partages)
inspiré de Packet Tracer, pour réviser l'épreuve E6 du BTS SIO SISR.
Tout est **simulé** : aucune VM, aucune commande système réelle.

## Stack

| Couche    | Outil                                                                   |
| --------- | ----------------------------------------------------------------------- |
| Desktop   | Electron 44 + electron-vite 5 (Vite 7)                                  |
| UI        | React 18 + TypeScript strict + Tailwind 4 + Zustand 5                   |
| Topologie | `@xyflow/react` (React Flow 12)                                         |
| Moteur    | TypeScript pur (`src/engine`), deps autorisées : `immer`, `zod`         |
| Tests     | Vitest (moteur) · Playwright `_electron` (E2E)                          |
| Packaging | electron-builder (NSIS + AppImage) · electron-updater (GitHub Releases) |

## Arborescence

```
src/main/      process principal : fenêtre, menu natif, IPC, fichiers .slab, mises à jour
src/preload/   pont contextBridge → window.serverlab (API minimale)
src/shared/    types partagés main/preload/renderer (contrat IPC)
src/renderer/  application React (index.html + src/)
src/engine/    moteur de simulation pur :
               model/ (schémas zod) · net/ (IPv4, routage, ARP) · sim/ (traces de paquets)
               services/ (rôles, DHCP, DNS, adds/ Active Directory, gpo/ stratégies, files/ NTFS et SMB)
               shell/ (PowerShell, cmd)
src/renderer/src/components/desktop/  Bureau simulé : DesktopShell (verrouillage, fenêtres, barre des
               tâches, menu Démarrer), apps.ts (registre des applications), apps/ (Gestionnaire de
               serveur, assistants, Connexions réseau, Propriétés système…), shell/ (fenêtres, menus)
labs/          labs pédagogiques *.json
tests/engine/  tests Vitest du moteur
tests/e2e/     scénarios Playwright Electron
build/         ressources de packaging (icône originale)
scripts/       scripts utilitaires (génération d'icône…)
```

## Commandes

```bash
npm ci               # installation
npm run dev          # lancement en développement (HMR)
npm run lint         # ESLint
npm run typecheck    # tsc sur main/preload, renderer, moteur, tests
npm test             # Vitest (moteur)
npm run build        # build electron-vite → out/
npm run test:e2e     # build + Playwright (sous Linux sans écran : xvfb-run -a npm run test:e2e)
npm run dist         # installeur local via electron-builder → dist/
```

## Règles d'architecture (non négociables)

1. **Source de vérité unique** : tout l'état simulé vit dans `LabState` (moteur).
   L'UI et les consoles appellent **les mêmes actions** du moteur. Jamais de logique métier dans un composant React.
2. **Moteur pur** : `src/engine` n'importe ni React, ni Electron, ni `node:*`, ni le DOM.
   Fonctions pures `(state, params) => EngineResult` (immer). Pas de `Math.random()` ni `Date.now()` :
   identifiants et MAC dérivés de `state.seq`, temps = `state.clock` (déterministe → testable).
3. **Erreurs métier** : `{ ok: false, error: { code, message } }` avec message **en français**, réaliste.
4. **Sécurité Electron** : `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, CSP stricte,
   preload minimal, arguments IPC validés dans le main, aucun accès disque générique exposé.
5. **Fichiers `.slab`** : JSON versionné (`schemaVersion`), validé par zod, migrations dans
   `src/engine/serialization/migrations.ts`. Toute évolution du format = nouvelle migration.

## Conventions

- Code et commentaires **en français** (identifiants en anglais), README en français.
- Sorties des consoles simulées en français (comme un serveur installé en FR).
- Aucune image/logo/nom Microsoft ou Cisco. Icônes : `lucide-react` uniquement. Ne jamais utiliser
  « Packet Tracer » ni « Windows » dans le nom ou le logo de l'application.
- Interface : couleurs via les **design tokens** de `src/renderer/src/styles.css` (`bg-panel`, `bg-surface`,
  `text-fg-muted`, `border-line`, `bg-accent`, `text-ok`…), jamais de couleur Tailwind brute dans l'application.
  Thème sombre par défaut + thème clair (Affichage > Thème). Le Bureau simulé reste en `data-theme="light"`
  et garde sa propre palette « système » (couleurs fixes dans `components/desktop`, `components/apps`, `mmc`).
  Polices : Inter (UI, 13 px) et JetBrains Mono (IP, MAC, consoles), embarquées.
- Commits : Conventional Commits (`feat(engine): …`, `fix(renderer): …`, `test: …`, `ci: …`, `docs: …`).
- Un commit par étape, tests verts avant d'enchaîner.

## Règles de travail (roadmap v1.1 → v5.0)

La roadmap est dans `ROADMAP.md` ; ses milestones, labels et issues sont décrits dans
`.github/roadmap/roadmap.json` et créés par le workflow « Roadmap sync » (ne crée que ce qui manque).

- Une issue = une branche `feat/<num>-<slug>` = une PR qui référence l'issue (`Closes #N`).
- Tests Vitest obligatoires pour toute logique du moteur ; CI verte avant de proposer le merge.
- Ne jamais mélanger deux issues dans une même PR.
- Ne jamais commencer un milestone avant que le précédent soit terminé et validé par Gary.
- À la fin de chaque issue : résumé en 3 lignes + comment tester manuellement.
- À la fin de chaque milestone : mise à jour de `CHANGELOG.md`, bump de version, tag `vX.Y.0`.
- Conventional Commits, code commenté en français.
- Aucune image/icône/logo Microsoft ou Cisco, aucune vraie commande système exécutée.

### Cibles d'architecture (prérequis v1.1)

- **Modules de rôles** : chaque rôle = un dossier `src/engine/roles/<rôle>` exposant un `RoleModule`
  (id, dépendances, état, cmdlets/outils, vues GUI, critères de lab, tâches de fond, évènements).
- **Commandes** : toute modification d'état = commande nommée `{ type, params }` passant par un
  `dispatch` unique ; annuler/rétablir et journal par patches immer (aucun inverse écrit à la main).
- **Migrations** : un fichier `.slab` de référence par version de schéma, testé.
- **Validation** : tout fichier importé passe par un schéma zod.

## Recettes

### Ajouter une cmdlet PowerShell

1. Implémenter l'action métier dans `src/engine/services/<service>.ts` (si elle n'existe pas).
2. Déclarer la cmdlet dans `src/engine/shell/powershell/cmdlets/<domaine>.ts` : nom, paramètres
   (type, obligatoire, position), handler qui appelle l'action → la complétion Tab est automatique.
3. Test Vitest dans `tests/engine/shell/` : sortie + état identique à l'action GUI.

### Publier une version

1. `git tag vX.Y.Z && git push origin vX.Y.Z` → workflow `release.yml` : brouillon, installeurs
   Windows (NSIS) et Linux (AppImage) envoyés par electron-builder, puis publication.
2. La version de l'application est celle du tag (alignée dans le workflow). Mises à jour :
   `src/main/updater.ts` (electron-updater, releases GitHub publiques, aucun jeton embarqué).

### Ajouter un critère de lab

1. Ajouter le type dans `src/engine/labs/criteria.ts` (schéma zod + évaluateur).
2. L'utiliser dans `labs/*.json` avec `label` et `hint` (l'indice ne donne jamais la solution).
3. Le test `tests/engine/labs/` applique la solution du lab et exige 100 % de critères validés.
