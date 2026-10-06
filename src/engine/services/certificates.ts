/**
 * Magasins de certificats de l'ordinateur : certificats auto-signés (New-SelfSignedCertificate),
 * chaîne de confiance (magasin Root) et correspondance avec un nom DNS (HTTPS).
 */
import type { Draft } from 'immer'
import { raise, transact, type EngineResult } from '../core/result'
import { nextSeq } from '../model/factory'
import type { Certificate, HostDevice, LabState } from '../model/schema'
import { requireDevice } from '../topology/actions'

const YEAR_MS = 365 * 24 * 3600 * 1000

/** Empreinte de 40 caractères hexadécimaux, déterministe (graine : state.seq et l'ordinateur). */
export function makeThumbprint(seed: number, salt: string): string {
  let h = (seed * 2654435761) >>> 0
  for (const c of salt) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0 || 1
  let out = ''
  while (out.length < 40) {
    // xorshift32
    h ^= h << 13
    h >>>= 0
    h ^= h >>> 17
    h ^= h << 5
    h >>>= 0
    out += h.toString(16).toUpperCase().padStart(8, '0')
  }
  return out.slice(0, 40)
}

function requireHost(draft: Draft<LabState>, deviceId: string): Draft<HostDevice> {
  const device = requireDevice(draft, deviceId)
  if (device.kind !== 'server' && device.kind !== 'client')
    raise('NotSupported', 'Cet équipement n’a pas de magasin de certificats.')
  return device
}

const DNS_NAME = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i

/** Ajoute un certificat (déjà construit) à un magasin de l'ordinateur. */
export function addCertificate(draft: Draft<LabState>, deviceId: string, cert: Certificate): void {
  const host = requireHost(draft, deviceId)
  host.host.certificates = host.host.certificates.filter(
    (c) => !(c.thumbprint === cert.thumbprint && c.store === cert.store)
  )
  host.host.certificates.push(cert)
}

/** Certificat auto-signé dans Cert:\LocalMachine\My (valable un an), comme New-SelfSignedCertificate. */
export function newSelfSignedCertificate(
  state: LabState,
  deviceId: string,
  dnsNames: string[]
): EngineResult<string> {
  return transact(state, (draft) => {
    const host = requireHost(draft, deviceId)
    const names = dnsNames.map((n) => n.trim().toLowerCase()).filter((n) => n)
    if (names.length === 0) raise('InvalidArgument', 'Indiquez au moins un nom DNS (-DnsName).')
    const bad = names.find((n) => !DNS_NAME.test(n))
    if (bad) raise('InvalidArgument', `« ${bad} » n’est pas un nom DNS valide.`)
    const thumbprint = makeThumbprint(nextSeq(draft), host.id)
    const subject = `CN=${names[0]}`
    addCertificate(draft, deviceId, {
      thumbprint,
      subject,
      issuer: subject,
      dnsNames: names,
      notBefore: draft.clock,
      notAfter: draft.clock + YEAR_MS,
      store: 'My',
      ca: false,
      issuerThumbprint: null
    })
    return thumbprint
  })
}

/** Le certificat couvre-t-il ce nom d'hôte (nom exact ou caractère générique *.domaine) ? */
export function certificateCovers(cert: Certificate, hostname: string): boolean {
  const name = hostname.toLowerCase()
  return cert.dnsNames.some((n) => {
    if (!n.startsWith('*.')) return n === name
    // *.lab.local couvre intranet.lab.local, pas lab.local ni a.b.lab.local
    const suffix = n.slice(1)
    const label = name.endsWith(suffix) ? name.slice(0, -suffix.length) : ''
    return label !== '' && !label.includes('.')
  })
}

/**
 * Le certificat est-il approuvé par cet ordinateur ? Son émetteur (lui-même s'il est auto-signé)
 * doit figurer dans le magasin des autorités de certification racines de confiance.
 */
export function certificateTrusted(host: HostDevice, cert: Certificate): boolean {
  const root = cert.issuerThumbprint ?? cert.thumbprint
  return host.host.certificates.some((c) => c.store === 'Root' && c.thumbprint === root)
}

/** Certificats du magasin Personnel (Cert:\LocalMachine\My). */
export function personalCertificates(host: HostDevice): Certificate[] {
  return host.host.certificates.filter((c) => c.store === 'My')
}
