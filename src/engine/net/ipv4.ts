/**
 * Utilitaires IPv4 : conversion, masques, sous-réseaux.
 * Les adresses sont manipulées en entiers non signés 32 bits.
 */

/** Convertit « a.b.c.d » en entier, ou null si la syntaxe est invalide. */
export function parseIpv4(text: string): number | null {
  const parts = text.trim().split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    value = value * 256 + n
  }
  return value >>> 0
}

export function formatIpv4(value: number): string {
  const v = value >>> 0
  return [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join('.')
}

export function isIpv4(text: string): boolean {
  return parseIpv4(text) !== null
}

/** Masque (entier) correspondant à une longueur de préfixe. */
export function prefixToMaskInt(prefix: number): number {
  if (prefix <= 0) return 0
  return (0xffffffff << (32 - prefix)) >>> 0
}

export function prefixToMask(prefix: number): string {
  return formatIpv4(prefixToMaskInt(prefix))
}

/** Longueur de préfixe d'un masque en notation pointée (null si le masque n'est pas contigu). */
export function maskToPrefix(mask: string): number | null {
  const value = parseIpv4(mask)
  if (value === null) return null
  for (let p = 0; p <= 32; p++) {
    if (prefixToMaskInt(p) === value) return p
  }
  return null
}

/** Accepte « 255.255.255.0 », « 24 » ou « /24 ». */
export function parseMaskOrPrefix(text: string): number | null {
  const t = text.trim().replace(/^\//, '')
  if (/^\d{1,2}$/.test(t)) {
    const p = Number(t)
    return p >= 0 && p <= 32 ? p : null
  }
  return maskToPrefix(t)
}

export function networkInt(ip: number, prefix: number): number {
  return (ip & prefixToMaskInt(prefix)) >>> 0
}

export function broadcastInt(ip: number, prefix: number): number {
  return (networkInt(ip, prefix) | (~prefixToMaskInt(prefix) >>> 0)) >>> 0
}

export function networkAddress(ip: string, prefix: number): string {
  const v = parseIpv4(ip)
  return v === null ? '' : formatIpv4(networkInt(v, prefix))
}

/** Vrai si les deux adresses sont dans le même sous-réseau pour le préfixe donné. */
export function sameSubnet(a: string, b: string, prefix: number): boolean {
  const va = parseIpv4(a)
  const vb = parseIpv4(b)
  if (va === null || vb === null) return false
  return networkInt(va, prefix) === networkInt(vb, prefix)
}

/** Vrai si `ip` appartient au réseau `network/prefix`. */
export function inNetwork(ip: string, network: string, prefix: number): boolean {
  return sameSubnet(ip, network, prefix)
}

export function isApipa(ip: string): boolean {
  return ip.startsWith('169.254.')
}

export function isLoopback(ip: string): boolean {
  return ip.startsWith('127.')
}

/** Notation CIDR « réseau/préfixe ». */
export function toCidr(ip: string, prefix: number): string {
  return `${networkAddress(ip, prefix)}/${prefix}`
}

/**
 * Vérifie qu'une adresse peut être attribuée à une carte réseau.
 * Renvoie un message d'erreur en français, ou null si l'adresse est valide.
 */
export function hostAddressError(ip: string, prefix: number): string | null {
  const v = parseIpv4(ip)
  if (v === null) return `« ${ip} » n’est pas une adresse IPv4 valide.`
  if (prefix < 1 || prefix > 32) return 'Longueur de préfixe invalide (1 à 32).'
  const first = v >>> 24
  if (first === 0) return 'Une adresse IP ne peut pas commencer par 0.'
  if (first === 127) return 'Les adresses 127.x.x.x sont réservées au bouclage local.'
  if (first >= 224)
    return 'Les adresses de multidiffusion ou réservées (224 et plus) ne peuvent pas être attribuées.'
  if (prefix <= 30) {
    if (v === networkInt(v, prefix))
      return `${ip} est l’adresse du réseau ${toCidr(ip, prefix)} : elle ne peut pas être attribuée à un hôte.`
    if (v === broadcastInt(v, prefix))
      return `${ip} est l’adresse de diffusion du réseau ${toCidr(ip, prefix)}.`
  }
  return null
}

/** Adresse APIPA déterministe dérivée de l'adresse MAC (169.254.x.y). */
export function apipaFromMac(mac: string): string {
  const bytes = mac.split(/[-:]/).map((b) => parseInt(b, 16))
  const b4 = bytes[4] ?? 0
  const b5 = bytes[5] ?? 0
  return `169.254.${(b4 % 254) + 1}.${(b5 % 254) + 1}`
}
