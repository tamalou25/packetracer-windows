/**
 * Serveur Web IIS : sites, liaisons (IP, port, en-tête d'hôte, certificat), dossier racine,
 * démarrage et arrêt. Deux sites démarrés ne peuvent pas partager une même liaison.
 */
import type { Draft } from 'immer'
import { raise, transact, type EngineResult } from '../../core/result'
import type { LabState, ServerDevice } from '../../model/schema'
import { isIpv4 } from '../../net/ipv4'
import { requireDevice } from '../../topology/actions'
import { findNode } from '../files/paths'
import { ensureRoleState } from '../state'
import type { IisBinding, IisServer, IisSite } from './schema'
import { IIS_STATE, bindingInformation, sameBinding } from './state'

export function requireIis(
  draft: Draft<LabState>,
  deviceId: string
): { device: Draft<ServerDevice>; iis: Draft<IisServer> } {
  const device = requireDevice(draft, deviceId)
  if (device.kind !== 'server' || !device.host.features.includes('Web-Server'))
    raise('IisNotInstalled', 'Le rôle Serveur Web (IIS) n’est pas installé sur cet ordinateur.')
  return { device, iis: ensureRoleState(device, IIS_STATE) }
}

export function findSite<T extends Pick<IisSite, 'name'>>(sites: T[], name: string): T {
  const site = sites.find((s) => s.name.toLowerCase() === name.trim().toLowerCase())
  if (!site) raise('SiteNotFound', `Le site Web « ${name} » est introuvable.`)
  return site
}

const HOST_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i

export interface BindingInput {
  protocol?: 'http' | 'https'
  ip?: string
  port?: number
  host?: string
  certificate?: string | null
}

/** Liaison validée (port par défaut selon le protocole). */
export function normalizeBinding(input: BindingInput): IisBinding {
  const protocol = input.protocol ?? 'http'
  const port = input.port ?? (protocol === 'https' ? 443 : 80)
  const ip = (input.ip ?? '*').trim() || '*'
  const host = (input.host ?? '').trim().toLowerCase()
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    raise('InvalidPort', `Le port ${port} n’est pas valide : indiquez un nombre entre 1 et 65535.`)
  if (ip !== '*' && !isIpv4(ip)) raise('InvalidAddress', `L’adresse IP « ${ip} » n’est pas valide.`)
  if (host && !HOST_NAME.test(host)) raise('InvalidHostName', `Le nom d’hôte « ${host} » n’est pas valide.`)
  return { protocol, ip, port, host, certificate: protocol === 'https' ? (input.certificate ?? null) : null }
}

/** Le certificat existe-t-il dans le magasin Personnel du serveur ? */
function requireCertificate(device: Draft<ServerDevice>, thumbprint: string | null): void {
  if (thumbprint && !device.host.certificates.some((c) => c.store === 'My' && c.thumbprint === thumbprint))
    raise(
      'CertificateNotFound',
      'Le certificat SSL choisi est introuvable dans le magasin Personnel du serveur.'
    )
}

/** Site démarré qui utilise déjà cette liaison (autre que `except`). */
function conflictingSite(
  iis: Draft<IisServer>,
  binding: IisBinding,
  except: number
): Draft<IisSite> | undefined {
  return iis.sites.find(
    (s) => s.id !== except && s.state === 'Started' && s.bindings.some((b) => sameBinding(b, binding))
  )
}

function requireFolder(device: Draft<ServerDevice>, path: string): string {
  const clean = path.trim().replace(/\\+$/, '')
  const node = findNode(device.storage, clean)
  if (node === undefined || (node && node.kind !== 'folder'))
    raise('PathNotFound', `Le dossier « ${path} » est introuvable sur ${device.name}.`)
  return clean.charAt(0).toUpperCase() + clean.slice(1)
}

export interface SiteInput {
  name: string
  physicalPath: string
  binding: BindingInput
}

/**
 * Nouveau site Web. Si sa liaison est déjà utilisée par un site démarré, il est créé arrêté
 * (valeur renvoyée : `started` faux), comme dans le Gestionnaire IIS.
 */
export function addSite(
  state: LabState,
  deviceId: string,
  input: SiteInput
): EngineResult<{ id: number; started: boolean }> {
  return transact(state, (draft) => {
    const { device, iis } = requireIis(draft, deviceId)
    const name = input.name.trim()
    if (!name) raise('InvalidName', 'Indiquez le nom du site.')
    if (iis.sites.some((s) => s.name.toLowerCase() === name.toLowerCase()))
      raise('SiteExists', `Un site nommé « ${name} » existe déjà.`)
    const physicalPath = requireFolder(device, input.physicalPath)
    const binding = normalizeBinding(input.binding)
    requireCertificate(device, binding.certificate)
    const id = Math.max(0, ...iis.sites.map((s) => s.id)) + 1
    const started = !conflictingSite(iis, binding, id)
    iis.sites.push({ id, name, physicalPath, state: started ? 'Started' : 'Stopped', bindings: [binding] })
    return { id, started }
  })
}

export function removeSite(state: LabState, deviceId: string, name: string): EngineResult {
  return transact(state, (draft) => {
    const { iis } = requireIis(draft, deviceId)
    const site = findSite(iis.sites, name)
    iis.sites = iis.sites.filter((s) => s.id !== site.id)
    return undefined
  })
}

/** Démarre ou arrête un site ; démarrage refusé si une liaison est utilisée par un autre site. */
export function setSiteState(
  state: LabState,
  deviceId: string,
  name: string,
  started: boolean
): EngineResult {
  return transact(state, (draft) => {
    const { iis } = requireIis(draft, deviceId)
    const site = findSite(iis.sites, name)
    if (started) {
      for (const b of site.bindings) {
        const other = conflictingSite(iis, b, site.id)
        if (other)
          raise(
            'BindingConflict',
            `Impossible de démarrer le site « ${site.name} » : la liaison ${b.protocol} ${bindingInformation(b)} est déjà utilisée par le site « ${other.name} ».`
          )
      }
    }
    site.state = started ? 'Started' : 'Stopped'
    return undefined
  })
}

export function addBinding(
  state: LabState,
  deviceId: string,
  name: string,
  input: BindingInput
): EngineResult<{ conflict: string | null }> {
  return transact(state, (draft) => {
    const { device, iis } = requireIis(draft, deviceId)
    const site = findSite(iis.sites, name)
    const binding = normalizeBinding(input)
    requireCertificate(device, binding.certificate)
    if (site.bindings.some((b) => sameBinding(b, binding)))
      raise(
        'BindingExists',
        `La liaison ${binding.protocol} ${bindingInformation(binding)} existe déjà sur ce site.`
      )
    // Liaison en double avec un autre site : acceptée, mais un seul des deux sites pourra démarrer
    const other = conflictingSite(iis, binding, site.id)
    site.bindings.push(binding)
    if (other && site.state === 'Started') site.state = 'Stopped'
    return { conflict: other ? other.name : null }
  })
}

export function removeBinding(
  state: LabState,
  deviceId: string,
  name: string,
  binding: Pick<IisBinding, 'protocol' | 'ip' | 'port' | 'host'>
): EngineResult {
  return transact(state, (draft) => {
    const { iis } = requireIis(draft, deviceId)
    const site = findSite(iis.sites, name)
    const target = { ...binding, certificate: null }
    const index = site.bindings.findIndex((b) => sameBinding(b, target))
    if (index < 0)
      raise(
        'BindingNotFound',
        `La liaison ${binding.protocol} ${bindingInformation(binding)} est introuvable.`
      )
    site.bindings.splice(index, 1)
    return undefined
  })
}

/** Certificat SSL d'une liaison https (null : aucun). */
export function setBindingCertificate(
  state: LabState,
  deviceId: string,
  name: string,
  binding: Pick<IisBinding, 'ip' | 'port' | 'host'>,
  thumbprint: string | null
): EngineResult {
  return transact(state, (draft) => {
    const { device, iis } = requireIis(draft, deviceId)
    const site = findSite(iis.sites, name)
    const target = site.bindings.find((b) =>
      sameBinding(b, { ...binding, protocol: 'https', certificate: null })
    )
    if (!target) raise('BindingNotFound', `La liaison https ${bindingInformation(binding)} est introuvable.`)
    requireCertificate(device, thumbprint)
    target.certificate = thumbprint
    return undefined
  })
}

export function setPhysicalPath(state: LabState, deviceId: string, name: string, path: string): EngineResult {
  return transact(state, (draft) => {
    const { device, iis } = requireIis(draft, deviceId)
    findSite(iis.sites, name).physicalPath = requireFolder(device, path)
    return undefined
  })
}
