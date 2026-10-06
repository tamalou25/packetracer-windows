/**
 * Commandes du rôle WSUS : actions pures du moteur + libellés français.
 */
import { def, on } from '../../commands/define'
import { deviceName } from '../../commands/labels'
import { CLASSIFICATION_LABELS } from './catalog'
import {
  addWsusGroup,
  approveWsusUpdate,
  assignWsusComputer,
  completeWsusPostInstall,
  declineWsusUpdate,
  removeWsusGroup,
  setWsusClassification,
  setWsusTargeting,
  synchronizeWsus
} from './server'

export const wsusCommands = {
  'wsus.postInstall': def(
    completeWsusPostInstall,
    (s, id, dir) => `Terminer la post-installation de WSUS (contenu dans ${dir})${on(s, id)}`
  ),
  'wsus.synchronize': def(synchronizeWsus, (s, id) => `Synchroniser le serveur WSUS${on(s, id)}`),
  'wsus.setClassification': def(
    setWsusClassification,
    (_s, _id, c, enabled) =>
      `${enabled ? 'Synchroniser' : 'Ne plus synchroniser'} : ${CLASSIFICATION_LABELS[c]}`
  ),
  'wsus.setTargeting': def(
    setWsusTargeting,
    (_s, _id, mode) =>
      `Ciblage WSUS ${mode === 'server' ? 'côté serveur (console)' : 'côté client (stratégie de groupe)'}`
  ),
  'wsus.addGroup': def(addWsusGroup, (_s, _id, name) => `Créer le groupe d’ordinateurs WSUS ${name}`),
  'wsus.removeGroup': def(
    removeWsusGroup,
    (_s, _id, name) => `Supprimer le groupe d’ordinateurs WSUS ${name}`
  ),
  'wsus.assignComputer': def(
    assignWsusComputer,
    (s, _id, computerId, group) =>
      `Placer ${deviceName(s, computerId)} dans le groupe WSUS ${group ?? 'Ordinateurs non attribués'}`
  ),
  'wsus.approve': def(
    approveWsusUpdate,
    (_s, _id, updateId, group, approved) =>
      `${approved ? 'Approuver' : 'Retirer l’approbation de'} ${updateId} pour ${group}`
  ),
  'wsus.decline': def(
    declineWsusUpdate,
    (_s, _id, updateId, declined) => `${declined ? 'Refuser' : 'Annuler le refus de'} ${updateId}`
  )
}
