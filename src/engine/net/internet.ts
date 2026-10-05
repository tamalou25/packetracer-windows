/**
 * Hôtes publics simulés derrière le nuage « Internet ».
 */
export interface InternetHost {
  ip: string
  name: string
  description: string
}

export const INTERNET_HOSTS: InternetHost[] = [
  { ip: '8.8.8.8', name: 'resolveur-a.example.net', description: 'Résolveur DNS public' },
  { ip: '1.1.1.1', name: 'resolveur-b.example.net', description: 'Résolveur DNS public' },
  { ip: '93.184.215.14', name: 'www.example.com', description: 'Site web public' }
]

/** TTL observé en réponse depuis un hôte Internet (simule une dizaine de routeurs traversés). */
export const INTERNET_REPLY_TTL = 117

export function isInternetHost(ip: string): boolean {
  return INTERNET_HOSTS.some((h) => h.ip === ip)
}
