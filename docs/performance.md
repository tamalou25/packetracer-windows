# Performance — topologie de 100 équipements

Mesures de l'issue #13. Topologie générée par `tests/support/large-lab.ts` : 100 équipements
(SW1 cœur, SRV1 DHCP/DNS, SRV2, R1, 7 switchs d'accès, 89 postes dont 1 sur 8 en statique ; SW8
isolé, ses postes restent sans bail), baux déjà obtenus comme dans un lab enregistré après usage.

## Remesurer

```bash
npm run perf:measure                                            # moteur (Vitest, médianes)
npm run build && xvfb-run -a npx playwright test tests/e2e/performance.spec.ts   # application
```

Le test E2E affiche une ligne `[perf]` ; il pose `window.serverlabPerf` pour compter les rendus
des nœuds et des câbles (instrumentation inactive sinon, `src/renderer/src/lib/perf.ts`).

Environnement des mesures : conteneur Linux 4 vCPU, Electron 44 sous xvfb (60 images/s).

## Avant (`feat/8-annuler-retablir`)

| Mesure                                                     | Valeur       |
| ---------------------------------------------------------- | ------------ |
| Moteur — ouverture (lecture + tâches de fond + canvas)     | 15,9 ms      |
| Moteur — glisser, par mouvement                            | 9,1 ms       |
| — dont tâches de fond                                      | 0,2 ms       |
| — dont calcul du canvas (état et IP des nœuds, voyants)    | 9,0 ms       |
| Application — ouverture jusqu'aux 100 nœuds affichés       | 226 à 433 ms |
| Application — glisser, par mouvement                       | 53 à 68 ms   |
| Application — image p95 / max pendant le glisser           | 33 / 50 ms   |
| Application — rendus des **autres** nœuds (glisser de 30)  | 6 047        |
| Application — rendus des **autres** câbles (glisser de 30) | 5 917        |

Causes : chaque nœud et chaque câble est abonné à tout le lab ; le canvas recrée tous les objets
nœuds à chaque mouvement ; le cache des conflits d'adresses (`ipConflicts`, parcours des segments
de niveau 2) est indexé sur l'état, qui change à chaque mouvement ; les tâches de fond repassent sur
tout le lab (DORA retenté pour les postes sans bail) après chaque modification.
