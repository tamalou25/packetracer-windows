/**
 * Pare-feu Windows Defender : profils, règles prédéfinies, locales et de stratégie de groupe,
 * effet réel sur le ping, le partage SMB et le Bureau à distance, paquet rejeté en Simulation.
 */
import { describe, expect, it } from 'vitest'
import {
  command,
  dispatch,
  effectiveRules,
  evaluateCheck,
  evaluateFirewall,
  openUnc,
  ping,
  sessionToken,
  unwrap,
  updateGpoSettings,
  type AnyCommand,
  type HostDevice,
  type LabState
} from '@engine/index'
import { buildReferenceLab } from '../serialization/reference-lab'
import { run } from '../shell/helpers'

const D = 'lab.local'
const id = (s: LabState, name: string) => Object.values(s.devices).find((d) => d.name === name)?.id ?? ''
const host = (s: LabState, name: string) => s.devices[id(s, name)] as HostDevice

function exec(state: LabState, ...cmds: AnyCommand[]): LabState {
  let s = state
  for (const cmd of cmds) {
    const r = dispatch(s, cmd)
    if (!r.ok) throw new Error(`${cmd.type} : ${r.error.message}`)
    s = r.state
  }
  return s
}

const pingOk = (s: LabState, from: string, to: string) => {
  const r = ping(s, id(s, from), to, { count: 1 })
  return r.ok && r.value.success
}

describe('Pare-feu : profils et règles prédéfinies', () => {
  it('installation neuve : trois profils actifs, entrant bloqué sauf règles des services', () => {
    const s = buildReferenceLab()
    const srv = host(s, 'SRV1')
    expect(srv.host.firewall.profiles.Public).toEqual({
      enabled: true,
      defaultInbound: 'Block',
      defaultOutbound: 'Allow'
    })
    const names = effectiveRules(srv).map((r) => r.id)
    // Rôles installés sur SRV1 : DNS, DHCP, AD DS
    expect(names).toEqual(
      expect.arrayContaining(['FPS-ICMP4-ERQ-In', 'DNSSrv-UDP-In', 'ADDS-LDAP-TCP-In', 'KDC-TCP-In'])
    )
    expect(names).not.toContain('IIS-WebServerRole-HTTP-In-TCP')
    // Bureau à distance non autorisé : sa règle est présente mais désactivée
    expect(effectiveRules(srv).find((r) => r.id === 'RemoteDesktop-UserMode-In-TCP')?.enabled).toBe(false)
    // Port non ouvert : bloqué par l'action par défaut
    const verdict = evaluateFirewall(srv, {
      direction: 'Inbound',
      transport: 'TCP',
      localPort: 8080,
      remoteAddress: '192.168.10.20'
    })
    expect(verdict.allowed).toBe(false)
    expect(verdict.profile).toBe('Domain')
    expect(verdict.reason).toContain('action par défaut du profil Domaine')
  })

  it('acceptation : ICMP bloqué → ping en échec, paquet rejeté visible en Simulation', () => {
    let s = buildReferenceLab()
    expect(pingOk(s, 'PC2', '192.168.10.1')).toBe(true)
    s = exec(s, command('firewall.setRuleEnabled', id(s, 'SRV1'), { name: 'FPS-ICMP4-ERQ-In' }, false))
    const r = ping(s, id(s, 'PC2'), '192.168.10.1', { count: 1 })
    expect(r.ok && r.value.success).toBe(false)
    const dropped = r.ok ? r.value.trace.events.filter((e) => e.outcome === 'dropped') : []
    expect(dropped.at(-1)?.note).toMatch(
      /Le pare-feu de SRV1 \(profil Domaine\) bloque ce trafic entrant : aucune règle ne l’autorise/
    )
    // Une règle de blocage l'emporte sur une règle d'autorisation
    s = exec(
      s,
      command('firewall.setRuleEnabled', id(s, 'SRV1'), { name: 'FPS-ICMP4-ERQ-In' }, true),
      command('firewall.newRule', id(s, 'SRV1'), {
        displayName: 'Bloquer ping PC2',
        direction: 'Inbound',
        action: 'Block',
        protocol: 'ICMPv4',
        remoteAddresses: ['192.168.10.20']
      })
    )
    expect(pingOk(s, 'PC2', '192.168.10.1')).toBe(false)
    // PC1 (autre adresse) répond toujours
    const pc1Ip = host(s, 'PC1').interfaces[0]!.dhcpLease!.address
    expect(pc1Ip).not.toBe('192.168.10.20')
    expect(pingOk(s, 'PC1', '192.168.10.1')).toBe(true)
  })

  it('profil désactivé : plus aucun filtrage ; une règle sortante bloque l’émetteur', () => {
    let s = buildReferenceLab()
    const srv = id(s, 'SRV1')
    s = exec(s, command('firewall.setRuleEnabled', srv, { name: 'FPS-ICMP4-ERQ-In' }, false))
    expect(pingOk(s, 'PC2', '192.168.10.1')).toBe(false)
    s = exec(s, command('firewall.setProfile', srv, ['Domain'], { enabled: false }))
    expect(pingOk(s, 'PC2', '192.168.10.1')).toBe(true)
    expect(
      evaluateCheck(s, { type: 'firewallProfile', device: 'SRV1', profile: 'Domain', enabled: false })
    ).toBe(true)
    // Règle sortante de blocage sur PC2
    s = exec(
      s,
      command('firewall.newRule', id(s, 'PC2'), {
        displayName: 'Bloquer ICMP sortant',
        direction: 'Outbound',
        action: 'Block',
        protocol: 'ICMPv4'
      })
    )
    expect(pingOk(s, 'PC2', '192.168.10.1')).toBe(false)
    expect(
      evaluateCheck(s, {
        type: 'firewallRule',
        device: 'PC2',
        direction: 'Outbound',
        action: 'Block',
        protocol: 'ICMPv4'
      })
    ).toBe(true)
  })

  it('acceptation : SMB bloqué → partage inaccessible', () => {
    let s = buildReferenceLab()
    const srv = id(s, 'SRV1')
    const token = sessionToken(s, srv)!
    s = exec(
      s,
      command('files.createItem', srv, 'C:\\Compta', 'folder', token, {}),
      command(
        'files.createShare',
        srv,
        { name: 'Compta', path: 'C:\\Compta', full: ['Tout le monde'] },
        token
      ),
      command('adds.logon', id(s, 'PC1'), { user: 'jdupont', password: 'Azerty123!', domain: 'LAB' })
    )
    const reach = (st: LabState) =>
      openUnc(st, id(st, 'PC1'), '\\\\SRV1\\Compta', sessionToken(st, id(st, 'PC1'))).ok
    expect(reach(s)).toBe(true)
    s = exec(
      s,
      command('firewall.newRule', srv, {
        displayName: 'Bloquer SMB',
        direction: 'Inbound',
        action: 'Block',
        protocol: 'TCP',
        localPorts: [445]
      })
    )
    expect(reach(s)).toBe(false)
    expect(evaluateCheck(s, { type: 'uncReachable', from: 'PC1', path: '\\\\SRV1\\Compta' })).toBe(false)
  })

  it('Bureau à distance : la règle suit l’autorisation des connexions, port personnalisé fermé', () => {
    let s = buildReferenceLab()
    const srv = host(s, 'SRV1')
    s = exec(s, command('rds.setRemoteDesktop', srv.id, { enabled: true }))
    expect(
      effectiveRules(host(s, 'SRV1')).find((r) => r.id === 'RemoteDesktop-UserMode-In-TCP')?.enabled
    ).toBe(true)
    s = exec(s, command('firewall.setRuleEnabled', srv.id, { group: 'Bureau à distance' }, false))
    expect(evaluateCheck(s, { type: 'firewallRule', device: 'SRV1', protocol: 'TCP', port: 3389 })).toBe(
      false
    )
  })

  it('réseau public ou privé hors domaine ; domaine : catégorie imposée', () => {
    let s = buildReferenceLab()
    const pc2 = id(s, 'PC2')
    expect(
      evaluateFirewall(host(s, 'PC2'), {
        direction: 'Inbound',
        transport: 'TCP',
        localPort: 80,
        remoteAddress: '192.168.10.1'
      }).profile
    ).toBe('Public')
    s = exec(s, command('firewall.setNetworkCategory', pc2, 'Private'))
    expect(host(s, 'PC2').host.firewall.networkCategory).toBe('Private')
    const domain = dispatch(s, command('firewall.setNetworkCategory', id(s, 'PC1'), 'Private'))
    expect(!domain.ok && domain.error.code).toBe('DomainNetwork')
  })

  it('stratégie de groupe : profil imposé et règles déployées, après gpupdate', () => {
    let s = buildReferenceLab()
    const gpo = s.domains[D]!.gpos.find((g) => g.name === 'Default Domain Policy')!
    s = unwrap(
      updateGpoSettings(s, D, gpo.id, {
        computer: {
          firewallDomain: 'Enabled',
          firewallRules: [
            {
              id: 'GPO-Block-Ping',
              displayName: 'Bloquer le ping (GPO)',
              group: '',
              direction: 'Inbound',
              action: 'Block',
              enabled: true,
              protocol: 'ICMPv4',
              localPorts: [],
              remoteAddresses: [],
              profiles: []
            }
          ]
        }
      })
    ).state
    // Sans gpupdate, la stratégie n'est pas encore appliquée sur PC1
    expect(effectiveRules(host(s, 'PC1')).some((r) => r.source === 'gpo')).toBe(false)
    s = run(s, id(s, 'PC1'), 'gpupdate /force', { shell: 'cmd' }).state
    expect(effectiveRules(host(s, 'PC1')).find((r) => r.id === 'GPO-Block-Ping')?.source).toBe('gpo')
    expect(pingOk(s, 'PC2', host(s, 'PC1').interfaces[0]!.dhcpLease!.address)).toBe(false)
    // Profil du domaine imposé : la désactivation locale reste sans effet
    s = exec(s, command('firewall.setProfile', id(s, 'PC1'), ['Domain'], { enabled: false }))
    expect(evaluateCheck(s, { type: 'firewallProfile', device: 'PC1', profile: 'Domain' })).toBe(true)
    // Rapport de stratégie résultante (administrateur du contrôleur de domaine)
    s = run(s, id(s, 'SRV1'), 'gpupdate /force', { shell: 'cmd' }).state
    expect(run(s, id(s, 'SRV1'), 'gpresult /v', { shell: 'cmd' }).text).toContain('Bloquer le ping (GPO)')
  })

  it('validation : nom, ports réservés à TCP/UDP, adresses, règle prédéfinie non supprimable', () => {
    const s = buildReferenceLab()
    const srv = id(s, 'SRV1')
    const err = (cmd: AnyCommand) => {
      const r = dispatch(s, cmd)
      return !r.ok && r.error.code
    }
    const base = { displayName: 'R', direction: 'Inbound' as const, action: 'Allow' as const }
    expect(err(command('firewall.newRule', srv, { ...base, displayName: ' ' }))).toBe('InvalidName')
    expect(err(command('firewall.newRule', srv, { ...base, protocol: 'ICMPv4', localPorts: [80] }))).toBe(
      'InvalidPort'
    )
    expect(err(command('firewall.newRule', srv, { ...base, protocol: 'TCP', localPorts: [70000] }))).toBe(
      'InvalidPort'
    )
    expect(err(command('firewall.newRule', srv, { ...base, remoteAddresses: ['10.0.0'] }))).toBe(
      'InvalidAddress'
    )
    expect(err(command('firewall.newRule', srv, { ...base, name: 'FPS-SMB-In-TCP' }))).toBe('RuleExists')
    expect(err(command('firewall.removeRule', srv, { name: 'FPS-SMB-In-TCP' }))).toBe('PredefinedRule')
    expect(err(command('firewall.setRuleEnabled', srv, { displayName: 'Absente' }, true))).toBe(
      'RuleNotFound'
    )
    expect(err(command('firewall.setRuleEnabled', id(s, 'SW1'), { name: 'x' }, true))).toBe('NotSupported')
  })
})

describe('Pare-feu : cmdlets NetSecurity et netsh advfirewall', () => {
  it('PowerShell : profils, nouvelle règle, désactivation par groupe, suppression', () => {
    let s = buildReferenceLab()
    const srv = id(s, 'SRV1')
    expect(run(s, srv, 'Get-NetFirewallProfile -Name Domain').text).toMatch(/Enabled\s+: True/)
    s = run(s, srv, 'Set-NetFirewallProfile -Profile Domain,Public -Enabled False').state
    expect(run(s, srv, 'Get-NetFirewallProfile -Name Public').text).toMatch(/Enabled\s+: False/)
    s = run(s, srv, 'Set-NetFirewallProfile -All -Enabled True').state
    s = run(
      s,
      srv,
      'New-NetFirewallRule -DisplayName "Web 8080" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow'
    ).state
    expect(
      evaluateCheck(s, { type: 'firewallRule', device: 'SRV1', displayName: 'Web 8080', port: 8080 })
    ).toBe(true)
    s = run(s, srv, 'Disable-NetFirewallRule -DisplayGroup "Partage de fichiers et d’imprimantes"').state
    expect(pingOk(s, 'PC2', '192.168.10.1')).toBe(false)
    expect(run(s, srv, 'Get-NetFirewallRule -Name FPS-ICMP4-ERQ-In').text).toMatch(/Enabled\s+: False/)
    s = run(s, srv, 'Get-NetFirewallRule -DisplayName "Web 8080" | Remove-NetFirewallRule').state
    expect(run(s, srv, 'Get-NetFirewallRule -DisplayName "Web 8080"').errors).toMatch(
      /Aucun objet MSFT_NetFirewallRule n’a été trouvé avec la propriété « DisplayName » égale à « Web 8080 »/
    )
    expect(run(s, id(s, 'PC2'), 'Get-NetConnectionProfile').text).toMatch(/NetworkCategory\s+: Public/)
    s = run(
      s,
      id(s, 'PC2'),
      'Set-NetConnectionProfile -InterfaceAlias Ethernet0 -NetworkCategory Private'
    ).state
    expect(run(s, id(s, 'PC2'), 'Get-NetConnectionProfile').text).toMatch(/NetworkCategory\s+: Private/)
  })

  it('netsh advfirewall : état, ajout, activation par groupe et suppression de règle', () => {
    let s = buildReferenceLab()
    const srv = id(s, 'SRV1')
    const cmd = (line: string) => run(s, srv, line, { shell: 'cmd' })
    expect(cmd('netsh advfirewall show currentprofile').text).toMatch(/État\s+ACTIF/)
    s = cmd('netsh advfirewall set allprofiles state off').state
    expect(cmd('netsh advfirewall show domainprofile').text).toMatch(/État\s+INACTIF/)
    s = cmd('netsh advfirewall set allprofiles state on').state
    s = cmd(
      'netsh advfirewall firewall add rule name="Bloquer ping" dir=in action=block protocol=icmpv4'
    ).state
    expect(pingOk(s, 'PC2', '192.168.10.1')).toBe(false)
    expect(cmd('netsh advfirewall firewall show rule name="Bloquer ping"').text).toMatch(/Action :\s+Bloquer/)
    const deleted = cmd('netsh advfirewall firewall delete rule name="Bloquer ping"')
    expect(deleted.text).toContain('1 règle(s) supprimée(s).')
    s = deleted.state
    s = cmd(
      'netsh advfirewall firewall set rule group="Partage de fichiers et d’imprimantes" new enable=no'
    ).state
    expect(pingOk(s, 'PC2', '192.168.10.1')).toBe(false)
    expect(cmd('netsh advfirewall firewall delete rule name="Absente"').errors).toContain(
      'Aucune règle ne correspond aux critères spécifiés.'
    )
  })
})
