/**
 * Commandes du rôle IIS : actions pures du moteur + libellés français.
 */
import { def, on } from '../../commands/define'
import {
  addBinding,
  addSite,
  removeBinding,
  removeSite,
  setBindingCertificate,
  setPhysicalPath,
  setSiteState
} from './server'
import { bindingInformation } from './state'

export const iisCommands = {
  'iis.addSite': def(addSite, (s, id, input) => `Créer le site Web ${input.name}${on(s, id)}`),
  'iis.removeSite': def(removeSite, (s, id, name) => `Supprimer le site Web ${name}${on(s, id)}`),
  'iis.setSiteState': def(
    setSiteState,
    (_s, _id, name, started) => `${started ? 'Démarrer' : 'Arrêter'} le site Web ${name}`
  ),
  'iis.addBinding': def(
    addBinding,
    (_s, _id, name, b) =>
      `Ajouter la liaison ${b.protocol ?? 'http'} ${bindingInformation({ ip: b.ip ?? '*', port: b.port ?? (b.protocol === 'https' ? 443 : 80), host: b.host ?? '' })} au site ${name}`
  ),
  'iis.removeBinding': def(
    removeBinding,
    (_s, _id, name, b) => `Supprimer la liaison ${b.protocol} ${bindingInformation(b)} du site ${name}`
  ),
  'iis.setBindingCertificate': def(
    setBindingCertificate,
    (_s, _id, name, b) => `Choisir le certificat SSL de la liaison ${bindingInformation(b)} (site ${name})`
  ),
  'iis.setPhysicalPath': def(
    setPhysicalPath,
    (_s, _id, name, path) => `Dossier racine du site ${name} : ${path}`
  )
}
