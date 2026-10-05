/**
 * Module du rôle Serveur DNS (et du résolveur DNS des ordinateurs).
 */
import { defineRole } from '../types'
import { dnsCmdlets } from './cmdlets'
import { dnsCommands } from './commands'
import { dnsCriteria } from './criteria'
import { DNS_STATE } from './state'
import { nslookupTool } from './tools'

export const dnsRole = defineRole({
  id: 'dns',
  displayName: 'DNS',
  feature: 'DNS',
  dependencies: [],
  features: [
    { name: 'DNS', displayName: 'Serveur DNS', role: true, managementTools: ['RSAT-DNS-Server'] },
    { name: 'RSAT-DNS-Server', displayName: 'Outils du serveur DNS', role: false }
  ],
  state: DNS_STATE,
  commands: dnsCommands,
  cmdlets: dnsCmdlets,
  tools: [nslookupTool],
  views: [
    {
      app: 'dns',
      label: 'DNS',
      run: ['dnsmgmt.msc'],
      tool: true,
      requires: { feature: 'RSAT-DNS-Server' }
    }
  ],
  criteria: dnsCriteria,
  backgroundTasks: [],
  events: { sources: ['DNS', 'DNS Server', 'Serveur DNS'] },
  services: [{ display: 'Serveur DNS', name: 'DNS', when: 'installed' }]
})
