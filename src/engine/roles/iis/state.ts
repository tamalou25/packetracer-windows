/**
 * Données du rôle IIS sur un serveur : définition (registre, validation) et accesseur typé.
 */
import { roleState } from '../state'
import type { RoleStateDef } from '../types'
import { IisServerSchema, type IisBinding, type IisServer } from './schema'

export const DEFAULT_SITE = 'Default Web Site'
export const DEFAULT_ROOT = 'C:\\inetpub\\wwwroot'

/** Documents par défaut, dans l'ordre de recherche d'IIS. */
export const DEFAULT_DOCUMENTS = [
  'Default.htm',
  'Default.asp',
  'index.htm',
  'index.html',
  'iisstart.htm',
  'default.aspx'
]

/** Serveur IIS tel qu'après l'installation : site par défaut lié à *:80. */
export function createIisServer(): IisServer {
  return {
    sites: [
      {
        id: 1,
        name: DEFAULT_SITE,
        physicalPath: DEFAULT_ROOT,
        state: 'Started',
        bindings: [{ protocol: 'http', ip: '*', port: 80, host: '', certificate: null }]
      }
    ]
  }
}

export const IIS_STATE: RoleStateDef<IisServer> = {
  key: 'iis',
  feature: 'Web-Server',
  schema: IisServerSchema,
  create: createIisServer
}

/** Données IIS d'un équipement (null si ce n'est pas un serveur IIS). */
export const iisServerOf = (device: Parameters<typeof roleState>[0]): IisServer | null =>
  roleState(device, IIS_STATE)

/** Liaison au format d'IIS : « *:80:intranet.lab.local ». */
export function bindingInformation(b: Pick<IisBinding, 'ip' | 'port' | 'host'>): string {
  return `${b.ip}:${b.port}:${b.host}`
}

/** Deux liaisons occupent-elles la même adresse (protocole, IP, port, en-tête d'hôte) ? */
export function sameBinding(a: IisBinding, b: IisBinding): boolean {
  return (
    a.protocol === b.protocol &&
    a.ip === b.ip &&
    a.port === b.port &&
    a.host.toLowerCase() === b.host.toLowerCase()
  )
}
