/**
 * Module du rôle Services de certificats Active Directory (autorité racine d'entreprise) et du
 * client des services de certificats des membres du domaine.
 */
import { defineRole } from '../types'
import { applyCertificateServicesClient } from './actions'
import { adcsCmdlets } from './cmdlets'
import { adcsCommands } from './commands'
import { adcsCriteria } from './criteria'
import { ADCS_STATE } from './state'
import { certutilTool } from './tools'

export const adcsRole = defineRole({
  id: 'adcs',
  displayName: 'AD CS',
  feature: 'ADCS-Cert-Authority',
  dependencies: ['adds', 'gpo'],
  features: [
    { name: 'AD-Certificate', displayName: 'Services de certificats Active Directory', role: true },
    {
      name: 'ADCS-Cert-Authority',
      displayName: 'Autorité de certification',
      role: true,
      parent: 'AD-Certificate',
      managementTools: ['RSAT-ADCS', 'RSAT-ADCS-Mgmt']
    },
    { name: 'RSAT-ADCS', displayName: 'Outils des services de certificats Active Directory', role: false },
    {
      name: 'RSAT-ADCS-Mgmt',
      displayName: 'Outils de gestion de l’autorité de certification',
      role: false,
      parent: 'RSAT-ADCS'
    }
  ],
  state: ADCS_STATE,
  commands: adcsCommands,
  cmdlets: adcsCmdlets,
  tools: [certutilTool],
  views: [
    {
      app: 'certsrv',
      label: 'Autorité de certification',
      run: ['certsrv.msc'],
      tool: true,
      requires: { feature: 'RSAT-ADCS-Mgmt' }
    }
  ],
  criteria: adcsCriteria,
  backgroundTasks: [],
  events: { sources: ['CertificationAuthority'] },
  services: [{ display: 'Services de certificats Active Directory', name: 'CertSvc', when: 'installed' }],
  onComputerPolicy: applyCertificateServicesClient
})
