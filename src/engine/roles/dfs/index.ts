/**
 * Module du rôle DFS : espaces de noms de domaine (référence des chemins \\domaine\racine) et
 * réplication DFS entre serveurs (tâche de fond).
 */
import { defineRole } from '../types'
import { dfsCmdlets } from './cmdlets'
import { dfsCommands } from './commands'
import { dfsCriteria } from './criteria'
import { resolveDfsPath } from './namespaces'
import { replicateAll } from './replication'
import { DFS_STATE } from './state'

export const dfsRole = defineRole({
  id: 'dfs',
  displayName: 'DFS',
  feature: 'FS-DFS-Namespace',
  dependencies: ['adds', 'files'],
  features: [
    {
      name: 'FS-DFS-Namespace',
      displayName: 'Espaces de noms DFS',
      role: true,
      parent: 'FileAndStorage-Services',
      managementTools: ['RSAT-DFS-Mgmt-Con']
    },
    {
      name: 'FS-DFS-Replication',
      displayName: 'Réplication DFS',
      role: true,
      parent: 'FileAndStorage-Services',
      managementTools: ['RSAT-DFS-Mgmt-Con']
    },
    { name: 'RSAT-DFS-Mgmt-Con', displayName: 'Outils de gestion DFS', role: false }
  ],
  state: DFS_STATE,
  commands: dfsCommands,
  cmdlets: dfsCmdlets,
  tools: [],
  views: [
    {
      app: 'dfsmgmt',
      label: 'Gestion du système de fichiers distribués DFS',
      run: ['dfsmgmt.msc'],
      tool: true,
      requires: { feature: 'RSAT-DFS-Mgmt-Con' }
    }
  ],
  criteria: dfsCriteria,
  backgroundTasks: [
    {
      id: 'dfs.replication',
      label: 'Réplication DFS',
      // Stockage et réseau des membres : pas de nouveau passage sans changement
      deps: (state) => [
        state.links,
        ...Object.values(state.devices).flatMap((d) =>
          d.kind === 'server' ? [d.roles['dfs'], d.storage, d.powered, d.interfaces] : []
        )
      ],
      run: replicateAll
    }
  ],
  events: { sources: ['DFSR'] },
  services: [
    { display: 'Espace de noms DFS', name: 'Dfs', when: 'installed' },
    { display: 'Réplication DFS', name: 'DFSR', when: 'installed' }
  ],
  resolveUnc: resolveDfsPath
})
