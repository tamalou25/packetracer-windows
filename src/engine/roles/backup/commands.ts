/**
 * Commandes de Sauvegarde Windows Server : actions pures du moteur + libellés français.
 */
import { def, on } from '../../commands/define'
import { recoverItem, removeBackupPolicy, setBackupPolicy, startBackup } from './actions'

export const backupCommands = {
  'backup.setPolicy': def(
    setBackupPolicy,
    (s, id, input) => `Planifier la sauvegarde quotidienne à ${input.time}${on(s, id)}`
  ),
  'backup.removePolicy': def(removeBackupPolicy, (s, id) => `Arrêter la sauvegarde planifiée${on(s, id)}`),
  'backup.start': def(startBackup, (s, id, input) =>
    input ? `Sauvegarde unique${on(s, id)}` : `Exécuter la sauvegarde planifiée${on(s, id)}`
  ),
  'backup.recover': def(recoverItem, (_s, _id, version, item) => `Récupérer ${item} (version ${version})`)
}
