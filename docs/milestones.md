# Journal des milestones v2.1 → v2.4

Suivi de la réalisation de la roadmap (`ROADMAP.md`), une issue = une branche `feat/<num>-<slug>` = une PR.
Ce journal permet à une nouvelle session de reprendre le travail là où il s'est arrêté.

## Conventions retenues

- **Format .slab** : une seule version de format par milestone. La première issue qui modifie le format
  incrémente `CURRENT_SCHEMA_VERSION` et écrit `fixtures/vN.slab` ; les issues suivantes du même milestone
  ajoutent des champs avec valeurs par défaut (le fichier de référence de la version reste valable).
  v2.1 → format 5.
- **Fidélité** : un comportement de Windows Server non sourcé est noté dans `docs/fidelite.md` (« à vérifier »).
- **Fin de milestone** : `CHANGELOG.md`, version de `package.json`, tag `vX.Y.0` poussé par Gary.

## v2.1 — Nouveaux rôles serveur

| Issue | Sujet                    | Branche        | PR  | État     |
| ----- | ------------------------ | -------------- | --- | -------- |
| #15   | Rôle WSUS                | `feat/15-wsus` |     | en cours |
| #16   | Rôle IIS                 |                |     | à faire  |
| #17   | Rôle RDS                 |                |     | à faire  |
| #18   | Rôle Hyper-V             |                |     | à faire  |
| #19   | Rôle AD CS               |                |     | à faire  |
| #20   | Rôle DFS                 |                |     | à faire  |
| #21   | Sauvegarde, corbeille AD |                |     | à faire  |

### #15 WSUS

- Moteur : `src/engine/roles/wsus/` (catalogue fictif KB91xxxxx, post-installation, synchronisation,
  classifications, groupes, ciblage serveur/client, approbations, refus) ; client : `wsusClientStatus`
  (stratégie appliquée → résolution DNS → échange HTTP 8530 tracé → groupe → mises à jour approuvées).
- GPO : « Spécifier l'emplacement intranet du service de mise à jour Microsoft » et « Autoriser le ciblage
  côté client » (Composants Windows > Windows Update). Protocole `HTTP` ajouté aux traces.
- Cmdlets : Get-WsusServer, Get-WsusClassification, Set-WsusClassification, Get-WsusUpdate,
  Approve-WsusUpdate, Deny-WsusUpdate, Get-WsusComputer, Add-WsusComputer.
- Interface : console « Services WSUS » (wsus.msc), page Windows Update des postes (ms-settings:windowsupdate).
- Lab `lab-06-wsus`, critères `wsusSynchronized`, `wsusApproval`, `wsusComputerGroup`, `wsusClientUpdate`.
