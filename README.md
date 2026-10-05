# ServerLab

Simulateur desktop d'administration de serveurs, pensé pour réviser l'**épreuve E6 du BTS SIO SISR**.
On construit une topologie (serveurs, postes, switchs, routeurs, Internet), puis on configure
les rôles serveur (AD DS, DNS, DHCP, GPO, partages) via une interface graphique ou des consoles
PowerShell / CMD simulées.

> Tout est **simulé** : aucune machine virtuelle, aucune commande système n'est exécutée.
> Projet indépendant, sans affiliation avec un éditeur de logiciels.

## État d'avancement

| Phase | Contenu                               | État |
| ----- | ------------------------------------- | ---- |
| 1     | Squelette Electron + CI               | ✅   |
| 2     | Canvas de topologie, fichiers `.slab` | ✅   |
| 3     | Moteur IP, mode Simulation            | ✅   |
| 4     | Consoles PowerShell / CMD             | ✅   |
| 5     | DHCP                                  | ✅   |
| 6–9   | DNS, AD DS, GPO, partages             | ⏳   |
| 10    | Mode Labs                             | ⏳   |
| 11    | Installeur + mises à jour             | ⏳   |

## Développement

Prérequis : **Node.js 22+** et npm.

```bash
npm ci            # installe les dépendances
npm run dev       # lance l'application en mode développement
npm run lint      # ESLint + Prettier
npm run typecheck # vérification TypeScript
npm test          # tests du moteur (Vitest)
npm run test:e2e  # build + tests E2E (Playwright)
npm run dist      # génère l'installeur dans dist/
```

Sous Linux sans écran (CI, conteneur) : `xvfb-run -a npm run test:e2e`.

## Architecture

| Dossier        | Rôle                                                                     |
| -------------- | ------------------------------------------------------------------------ |
| `src/main`     | Process principal Electron : fenêtre, menu natif, fichiers, mises à jour |
| `src/preload`  | Pont sécurisé (`contextBridge`) exposant une API minimale                |
| `src/renderer` | Interface React (canvas React Flow, panneaux, consoles)                  |
| `src/engine`   | Moteur de simulation **pur TypeScript** (testable seul)                  |
| `labs`         | Labs pédagogiques au format JSON                                         |
| `tests`        | Tests Vitest (moteur) et Playwright (E2E)                                |

Sécurité : `contextIsolation`, `sandbox`, pas de `nodeIntegration`, CSP stricte, navigation bloquée.

Voir [`CLAUDE.md`](./CLAUDE.md) pour les conventions détaillées.
