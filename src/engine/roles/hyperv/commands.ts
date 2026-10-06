/**
 * Commandes du rôle Hyper-V : actions pures du moteur + libellés français.
 */
import { def, on } from '../../commands/define'
import { VSWITCH_TYPE_LABELS } from './state'
import {
  addVMNetworkAdapter,
  connectVMNetworkAdapter,
  newVM,
  newVMSwitch,
  removeVM,
  removeVMSwitch,
  setVMMemory,
  setVMState
} from './actions'

export const hypervCommands = {
  'hyperv.newSwitch': def(
    newVMSwitch,
    (s, id, input) =>
      `Créer le commutateur virtuel ${VSWITCH_TYPE_LABELS[input.type].toLowerCase()} ${input.name}${on(s, id)}`
  ),
  'hyperv.removeSwitch': def(removeVMSwitch, (_s, _id, name) => `Supprimer le commutateur virtuel ${name}`),
  'hyperv.newVm': def(newVM, (s, id, input) => `Créer la machine virtuelle ${input.name}${on(s, id)}`),
  'hyperv.removeVm': def(removeVM, (_s, _id, name) => `Supprimer la machine virtuelle ${name}`),
  'hyperv.setVmState': def(
    setVMState,
    (_s, _id, name, running) => `${running ? 'Démarrer' : 'Arrêter'} la machine virtuelle ${name}`
  ),
  'hyperv.connectAdapter': def(connectVMNetworkAdapter, (_s, _id, vm, switchName) =>
    switchName
      ? `Connecter ${vm} au commutateur virtuel ${switchName}`
      : `Déconnecter la carte réseau de ${vm}`
  ),
  'hyperv.addAdapter': def(addVMNetworkAdapter, (_s, _id, vm) => `Ajouter une carte réseau à ${vm}`),
  'hyperv.setMemory': def(setVMMemory, (_s, _id, vm, mb) => `Mémoire de démarrage de ${vm} : ${mb} Mo`)
}
