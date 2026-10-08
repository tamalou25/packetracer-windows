/**
 * Lab de démonstration du mode Red/Blue, construit avec les actions du moteur (mêmes que
 * l'interface) : domaine lab.local sur SRV1, switch Cisco 2960 SW1 et trois postes dans le VLAN 10.
 * Partagé par les tests Vitest et le test E2E (imports relatifs : pas d'alias).
 *
 * Vulnérable : compte jdupont au mot de passe hors stratégie, aucun verrouillage, compte de service
 * svc-sql (SPN) au mot de passe ancien, aucune protection sur SW1. Durci : les cinq contre-mesures
 * du catalogue sont déjà en place.
 */
import {
  addDevice,
  addUser,
  connect,
  createLab,
  installFeatures,
  installForest,
  runIosScript,
  setInterfaceIpv4,
  unwrap,
  type HostDevice,
  type LabState
} from '../src/engine/index'

const DAY = 86_400_000

export function redBlueLab(): LabState {
  let s = createLab()
  const add = (kind: 'server' | 'client' | 'switch', name: string, x: number, y: number) => {
    const r = unwrap(
      addDevice(s, {
        kind,
        position: { x, y },
        name,
        ...(kind === 'switch' ? { model: 'c2960' as const } : {})
      })
    )
    s = r.state
    return r.value
  }
  const sw = add('switch', 'SW1', 400, 320)
  const hosts: [string, 'server' | 'client', string, number][] = [
    ['SRV1', 'server', '192.168.10.1', 0],
    ['PC1', 'client', '192.168.10.10', 1],
    ['PC2', 'client', '192.168.10.20', 2],
    ['PC3', 'client', '192.168.10.66', 3]
  ]
  const ids: Record<string, string> = {}
  for (const [name, kind, address, i] of hosts) {
    const id = add(kind, name, 150 + i * 200, 120)
    ids[name] = id
    const port = (d: string, n: number) => ({ deviceId: d, ifaceId: s.devices[d]?.interfaces[n]?.id ?? '' })
    s = unwrap(connect(s, port(id, 0), port(sw, i))).state
    s = unwrap(
      setInterfaceIpv4(s, id, port(id, 0).ifaceId, {
        addressing: 'static',
        address,
        mask: '24',
        gateway: null,
        dnsServers: ['192.168.10.1']
      })
    ).state
  }
  s = runIosScript(s, sw, [
    'enable',
    'configure terminal',
    'vlan 10',
    'exit',
    'vlan 20',
    'exit',
    ...['Fa0/1', 'Fa0/2', 'Fa0/3', 'Fa0/4'].flatMap((p) => [
      `interface ${p}`,
      'switchport mode access',
      'switchport access vlan 10',
      'exit'
    ]),
    'end'
  ])
  s = unwrap(installFeatures(s, ids['SRV1']!, ['AD-Domain-Services'], { includeManagementTools: true })).state
  s = unwrap(installForest(s, ids['SRV1']!, { domainName: 'lab.local', safeModePassword: 'P@ssw0rd!' })).state
  for (const [name, sam] of [
    ['Jean Dupont', 'jdupont'],
    ['Service SQL', 'svc-sql']
  ] as const)
    s = unwrap(
      addUser(s, 'lab.local', {
        name,
        sam,
        path: 'CN=Users,DC=lab,DC=local',
        password: 'Azerty123!',
        enabled: true
      })
    ).state
  // Données du lab (faiblesses et cibles) : posées directement, comme le ferait le départ d'un lab
  const lab = structuredClone(s)
  lab.clock = 200 * DAY
  const domain = lab.domains['lab.local']!
  domain.users.find((u) => u.sam === 'jdupont')!.password = 'jdupont'
  const svc = domain.users.find((u) => u.sam === 'svc-sql')!
  svc.spns = ['MSSQLSvc/srv1.lab.local:1433']
  svc.passwordLastSet = 0
  const pc1 = lab.devices[ids['PC1']!] as HostDevice
  pc1.host.session = { user: 'jdupont', domain: 'LAB' }
  pc1.host.adminTargets = [ids['SRV1']!]
  lab.cyber = {
    ...lab.cyber,
    targetAccount: 'jdupont',
    arpSpoof: { attacker: 'PC3', victimA: 'PC1', victimB: 'PC2' },
    vlanHop: { attacker: 'PC3', toVlan: 20 }
  }
  return lab
}
