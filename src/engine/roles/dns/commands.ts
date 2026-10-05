/**
 * Commandes du rôle DNS : actions pures du moteur + libellés français.
 */
import { def, on } from '../../commands/define'
import { addPrimaryZone, addRecord, removeRecord, removeZone, setForwarders } from './server'

export const dnsCommands = {
  'dns.addPrimaryZone': def(
    addPrimaryZone,
    (s, id, z) => `Créer la zone ${z.name ?? z.networkId ?? ''}${on(s, id)}`
  ),
  'dns.removeZone': def(removeZone, (s, id, zone) => `Supprimer la zone ${zone}${on(s, id)}`),
  'dns.addRecord': def(
    addRecord,
    (_s, _id, zone, r) => `Ajouter l’enregistrement ${r.type} ${r.name} dans ${zone}`
  ),
  'dns.removeRecord': def(
    removeRecord,
    (_s, _id, zone, name, type) => `Supprimer l’enregistrement ${type} ${name} de ${zone}`
  ),
  'dns.setForwarders': def(setForwarders, (s, id) => `Modifier les redirecteurs${on(s, id)}`)
}
