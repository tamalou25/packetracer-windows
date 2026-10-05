# Fichiers .slab de référence

Un fichier par version du format (`schemaVersion`), produit **par le code de cette version** avec le
même scénario (`../reference-lab.ts`) : contrôleur de domaine `lab.local` (DNS, DHCP autorisé),
switch, routeur, poste en DHCP joint au domaine, poste statique, OU, utilisateur et groupe.

| Fichier   | Format | Produit avec                                       |
| --------- | ------ | -------------------------------------------------- |
| `v1.slab` | 1      | commit `6da8368` (Bureau façon serveur, avant GPO) |
| `v2.slab` | 2      | commit `4379438` (GPO + fichiers, avant les labs)  |
| `v3.slab` | 3      | ServerLab 1.0.0 (`npm run fixture:slab`)           |

Ces fichiers ne doivent **jamais** être modifiés ni régénérés : ils représentent les fichiers que
des utilisateurs ont réellement enregistrés. `../migrations.test.ts` vérifie que chacun s'ouvre,
migre jusqu'au format courant et reste utilisable.
