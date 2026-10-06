/**
 * Commandes du rôle AD CS : actions pures du moteur + libellés français.
 */
import { def, on } from '../../commands/define'
import { deviceName } from '../../commands/labels'
import {
  addCaTemplate,
  installCertificationAuthority,
  pulseAutoEnrollment,
  removeCaTemplate,
  requestCertificate,
  revokeCertificate
} from './actions'
import { CERT_TEMPLATES, templateName } from './state'

const display = (name: string) => CERT_TEMPLATES[templateName(name) ?? '']?.display ?? name

export const adcsCommands = {
  'adcs.install': def(
    installCertificationAuthority,
    (s, id) => `Configurer l’autorité de certification racine d’entreprise${on(s, id)}`
  ),
  'adcs.addTemplate': def(
    addCaTemplate,
    (_s, _id, name) => `Publier le modèle de certificat ${display(name)}`
  ),
  'adcs.removeTemplate': def(
    removeCaTemplate,
    (_s, _id, name) => `Retirer le modèle de certificat ${display(name)}`
  ),
  'adcs.request': def(
    requestCertificate,
    (s, id, input) => `Demander un certificat ${display(input.template)} pour ${deviceName(s, id)}`
  ),
  'adcs.revoke': def(revokeCertificate, (_s, _id, serial) => `Révoquer le certificat ${serial}`),
  'adcs.pulse': def(pulseAutoEnrollment, (s, id) => `Déclencher l’inscription automatique${on(s, id)}`)
}
