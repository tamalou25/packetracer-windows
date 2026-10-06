/**
 * Commandes du rôle DFS : actions pures du moteur + libellés français.
 */
import { def, on } from '../../commands/define'
import {
  addFolderTarget,
  newNamespace,
  newNamespaceFolder,
  removeFolderTarget,
  removeNamespace,
  removeNamespaceFolder
} from './namespaces'
import {
  addReplicationMember,
  newReplicatedFolder,
  newReplicationGroup,
  removeReplicationGroup,
  setMembership,
  syncReplicationGroup
} from './replication'

export const dfsCommands = {
  'dfs.newNamespace': def(newNamespace, (s, id, input) => `Créer l’espace de noms ${input.name}${on(s, id)}`),
  'dfs.removeNamespace': def(removeNamespace, (_s, _id, name) => `Supprimer l’espace de noms ${name}`),
  'dfs.newFolder': def(
    newNamespaceFolder,
    (_s, path, target) => `Créer le dossier ${path} (cible ${target})`
  ),
  'dfs.addTarget': def(addFolderTarget, (_s, path, target) => `Ajouter la cible ${target} à ${path}`),
  'dfs.removeTarget': def(removeFolderTarget, (_s, path, target) => `Retirer la cible ${target} de ${path}`),
  'dfs.removeFolder': def(removeNamespaceFolder, (_s, path) => `Supprimer le dossier ${path}`),
  'dfs.newGroup': def(newReplicationGroup, (_s, _id, name) => `Créer le groupe de réplication ${name}`),
  'dfs.removeGroup': def(removeReplicationGroup, (_s, name) => `Supprimer le groupe de réplication ${name}`),
  'dfs.addMember': def(
    addReplicationMember,
    (_s, group, computer) => `Ajouter ${computer} au groupe ${group}`
  ),
  'dfs.newReplicatedFolder': def(
    newReplicatedFolder,
    (_s, group, folder) => `Créer le dossier répliqué ${folder} (${group})`
  ),
  'dfs.setMembership': def(
    setMembership,
    (_s, _group, folder, computer, input) =>
      `Dossier répliqué ${folder} sur ${computer} : ${input.contentPath}`
  ),
  'dfs.sync': def(syncReplicationGroup, (_s, group) => `Répliquer maintenant le groupe ${group}`)
}
