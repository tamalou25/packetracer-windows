/**
 * Données du rôle AD CS sur un serveur, modèles de certificats connus et accesseurs.
 */
import type { LabState, ServerDevice } from '../../model/schema'
import { roleState } from '../state'
import type { RoleStateDef } from '../types'
import { AdcsServerSchema, type AdcsServer } from './schema'

export const ADCS_STATE: RoleStateDef<AdcsServer> = {
  key: 'adcs',
  feature: 'ADCS-Cert-Authority',
  schema: AdcsServerSchema,
  create: () => ({
    configured: false,
    caName: '',
    caType: 'EnterpriseRootCA',
    caThumbprint: null,
    templates: [],
    issued: []
  })
}

export const adcsOf = (device: Parameters<typeof roleState>[0]): AdcsServer | null =>
  roleState(device, ADCS_STATE)

/** Modèles de certificats (nom court → nom affiché, sujet : ordinateur, utilisateur ou serveur Web). */
export const CERT_TEMPLATES: Record<string, { display: string; kind: 'computer' | 'user' | 'web' | 'ca' }> = {
  Administrator: { display: 'Administrateur', kind: 'user' },
  EFS: { display: 'EFS de base', kind: 'user' },
  EFSRecovery: { display: 'Agent de récupération EFS', kind: 'user' },
  DirectoryEmailReplication: { display: 'Réplication de la messagerie de l’annuaire', kind: 'computer' },
  DomainController: { display: 'Contrôleur de domaine', kind: 'computer' },
  DomainControllerAuthentication: { display: 'Authentification du contrôleur de domaine', kind: 'computer' },
  KerberosAuthentication: { display: 'Authentification Kerberos', kind: 'computer' },
  Machine: { display: 'Ordinateur', kind: 'computer' },
  SubCA: { display: 'Autorité de certification secondaire', kind: 'ca' },
  User: { display: 'Utilisateur', kind: 'user' },
  WebServer: { display: 'Serveur Web', kind: 'web' },
  Workstation: { display: 'Authentification de station de travail', kind: 'computer' }
}

/** Modèles publiés par défaut par une autorité racine d'entreprise. */
export const DEFAULT_TEMPLATES = [
  'DirectoryEmailReplication',
  'DomainControllerAuthentication',
  'KerberosAuthentication',
  'EFSRecovery',
  'EFS',
  'DomainController',
  'WebServer',
  'Machine',
  'User',
  'SubCA',
  'Administrator'
]

/** Nom court d'un modèle (nom court ou affiché, sans casse), sinon null. */
export function templateName(name: string): string | null {
  const lower = name.trim().toLowerCase()
  return (
    Object.entries(CERT_TEMPLATES).find(
      ([short, t]) => short.toLowerCase() === lower || t.display.toLowerCase() === lower
    )?.[0] ?? null
  )
}

/** Autorités de certification d'entreprise configurées d'un domaine. */
export function enterpriseCas(
  state: LabState,
  domainName: string
): { server: ServerDevice; ca: AdcsServer }[] {
  return Object.values(state.devices).flatMap((d) => {
    if (d.kind !== 'server' || d.host.domain !== domainName) return []
    const ca = adcsOf(d)
    return ca?.configured && d.host.features.includes('ADCS-Cert-Authority') ? [{ server: d, ca }] : []
  })
}
