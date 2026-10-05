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
               services/ (rôles, DHCP, DNS, adds/ Active Directory, gpo/ stratégies de groupe)
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

## Recettes

### Ajouter une cmdlet PowerShell

1. Implémenter l'action métier dans `src/engine/services/<service>.ts` (si elle n'existe pas).
2. Déclarer la cmdlet dans `src/engine/shell/powershell/cmdlets/<domaine>.ts` : nom, paramètres
   (type, obligatoire, position), handler qui appelle l'action → la complétion Tab est automatique.
3. Test Vitest dans `tests/engine/shell/` : sortie + état identique à l'action GUI.

### Ajouter un critère de lab

1. Ajouter le type dans `src/engine/labs/criteria.ts` (schéma zod + évaluateur).
2. L'utiliser dans `labs/*.json` avec `label` et `hint` (l'indice ne donne jamais la solution).
3. Le test `tests/engine/labs/` applique la solution du lab et exige 100 % de critères validés.
