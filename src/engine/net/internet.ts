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
  { ip: '93.184.215.14', name: 'www.example.com', description: 'Site web public' },
  { ip: '198.41.0.4', name: 'a.root-servers.net', description: 'Serveur racine DNS' }
]

/** Noms publics résolus par les résolveurs Internet (enregistrements A). */
export const PUBLIC_DNS: Record<string, string> = {
  'www.example.com': '93.184.215.14',
  'example.com': '93.184.215.14',
  'resolveur-a.example.net': '8.8.8.8',
  'resolveur-b.example.net': '1.1.1.1',
  'a.root-servers.net': '198.41.0.4'
}

/** Résolveurs DNS publics (répondent aux requêtes récursives). */
export const PUBLIC_RESOLVERS = ['8.8.8.8', '1.1.1.1']

/** Serveur racine utilisé par les indications de racine. */
export const ROOT_HINT_IP = '198.41.0.4'

/** TTL observé en réponse depuis un hôte Internet (simule une dizaine de routeurs traversés). */
export const INTERNET_REPLY_TTL = 117

export function isInternetHost(ip: string): boolean {
  return INTERNET_HOSTS.some((h) => h.ip === ip)
}
