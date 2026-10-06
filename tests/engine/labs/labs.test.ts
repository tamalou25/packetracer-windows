import { describe, expect, it } from 'vitest'
import {
  addPrimaryZone,
  addRecord,
  addScope,
  autoConfigureDhcp,
  buildLabStart,
  command,
  dispatch,
  checkLab,
  createItem,
  createShare,
  domainToken,
  grantNtfs,
  installFeatures,
  joinDomain,
  logon,
  mapDrive,
  parseLab,
  parseSlab,
  removeNtfs,
  restartComputer,
  runBackgroundTasks,
  setDhcpOptions,
  setInterfaceIpv4,
  setNtfsInheritance,
  serializeSlab,
  sessionToken,
  unwrap,
  updateGpoSettings,
  type AnyCommand,
  type Domain,
  type LabDefinition,
  type LabState
} from '@engine/index'
import lab1 from '../../../labs/lab-01-adressage.json'
import lab2 from '../../../labs/lab-02-dhcp.json'
import lab3 from '../../../labs/lab-03-dns.json'
import lab4 from '../../../labs/lab-04-ad-gpo.json'
import lab5 from '../../../labs/lab-05-ntfs.json'
import lab6 from '../../../labs/lab-06-wsus.json'
import lab7 from '../../../labs/lab-07-iis.json'
import lab8 from '../../../labs/lab-08-rds.json'
import lab9 from '../../../labs/lab-09-hyperv.json'
import lab10 from '../../../labs/lab-10-adcs.json'
import lab11 from '../../../labs/lab-11-dfs.json'
import { run } from '../shell/helpers'

function load(raw: unknown): LabDefinition {
  const parsed = parseLab(raw)
  if (!parsed.ok) throw new Error(parsed.message)
  return parsed.lab
}

const id = (s: LabState, name: string) => Object.values(s.devices).find((d) => d.name === name)?.id ?? ''

function ip(
  s: LabState,
  device: string,
  port: string | null,
  cidr: string,
  gateway?: string,
  dns: string[] = []
) {
  const d = s.devices[id(s, device)]
  const iface = port ? d?.interfaces.find((i) => i.name === port) : d?.interfaces.find((i) => i.l3)
  const [address = '', mask = '24'] = cidr.split('/')
  return unwrap(
    setInterfaceIpv4(s, id(s, device), iface?.id ?? '', {
      addressing: 'static',
      address,
      mask,
      gateway: gateway ?? null,
      dnsServers: dns
    })
  ).state
}

/** Solutions de référence : mêmes actions que l'interface et les consoles. */
const SOLUTIONS: Record<string, (s: LabState) => LabState> = {
  'lab-01-adressage': (s) => {
    s = ip(s, 'R1', 'Gi0/0', '192.168.10.254/24')
    s = ip(s, 'R1', 'Gi0/1', '192.168.20.254/24')
    s = ip(s, 'PC1', null, '192.168.10.10/24', '192.168.10.254')
    return ip(s, 'PC2', null, '192.168.20.10/24', '192.168.20.254')
  },
  'lab-02-dhcp': (s) => {
    const srv = id(s, 'SRV1')
    s = unwrap(installFeatures(s, srv, ['DHCP'], { includeManagementTools: true })).state
    const scope = unwrap(
      addScope(s, srv, { name: 'LAN', start: '192.168.10.100', end: '192.168.10.200', mask: '255.255.255.0' })
    )
    s = unwrap(
      setDhcpOptions(scope.state, srv, scope.value, {
        router: ['192.168.10.254'],
        dnsServers: ['192.168.10.1']
      })
    ).state
    return autoConfigureDhcp(s).state
  },
  'lab-03-dns': (s) => {
    const srv = id(s, 'SRV1')
    s = unwrap(installFeatures(s, srv, ['DNS'], { includeManagementTools: true })).state
    s = unwrap(addPrimaryZone(s, srv, { name: 'entreprise.local' })).state
    s = unwrap(addPrimaryZone(s, srv, { networkId: '192.168.10.0/24' })).state
    s = unwrap(
      addRecord(s, srv, 'entreprise.local', {
        name: 'srv1',
        type: 'A',
        data: '192.168.10.1',
        createPtr: true
      })
    ).state
    s = unwrap(addRecord(s, srv, 'entreprise.local', { name: 'pc1', type: 'A', data: '192.168.10.10' })).state
    return unwrap(
      addRecord(s, srv, 'entreprise.local', {
        name: 'intranet',
        type: 'CNAME',
        data: 'srv1.entreprise.local'
      })
    ).state
  },
  'lab-04-ad-gpo': (s) => {
    const ps = (line: string) => {
      s = run(s, id(s, 'SRV1'), line).state
    }
    ps('New-ADOrganizationalUnit -Name Compta')
    ps(
      'New-ADUser -Name "Jean Dupont" -SamAccountName jdupont -Path "OU=Compta,DC=lab,DC=local" -AccountPassword (ConvertTo-SecureString "Azerty123!" -AsPlainText -Force) -Enabled $true'
    )
    ps('New-ADGroup -Name GG_Compta -GroupScope Global -Path "OU=Compta,DC=lab,DC=local"')
    ps('Add-ADGroupMember -Identity GG_Compta -Members jdupont')
    const joined = joinDomain(s, id(s, 'PC1'), {
      domain: 'lab.local',
      user: 'LAB\\Administrateur',
      password: 'P@ssw0rd'
    })
    s = unwrap(restartComputer(joined.state, id(s, 'PC1'))).state
    ps('New-GPO -Name GPO-Compta')
    ps('New-GPLink -Name GPO-Compta -Target "OU=Compta,DC=lab,DC=local"')
    const gpo = (s.domains['lab.local'] as Domain).gpos.find((g) => g.name === 'GPO-Compta')
    s = unwrap(
      updateGpoSettings(s, 'lab.local', gpo?.id ?? '', { user: { noControlPanel: 'Enabled' } })
    ).state
    return logon(s, id(s, 'PC1'), { user: 'jdupont', password: 'Azerty123!', domain: 'LAB' }).state
  },
  'lab-05-ntfs': (s) => {
    const srv = id(s, 'SRV1')
    const admin = domainToken(s.domains['lab.local'] as Domain, 'Administrateur')!
    const path = 'C:\\Partages\\Compta'
    s = unwrap(createItem(s, srv, path, 'folder', admin, { parents: true })).state
    s = unwrap(createShare(s, srv, { name: 'Compta', path, full: ['Tout le monde'] }, admin)).state
    s = unwrap(setNtfsInheritance(s, srv, path, 'convert', admin)).state
    s = unwrap(removeNtfs(s, srv, path, 'BUILTIN\\Utilisateurs', 'all', admin)).state
    s = unwrap(
      grantNtfs(s, srv, path, { principal: 'LAB\\GG_Compta', type: 'Allow', rights: ['Modify'] }, admin)
    ).state
    s = unwrap(
      grantNtfs(
        s,
        srv,
        path,
        { principal: 'LAB\\GG_Direction', type: 'Allow', rights: ['ReadAndExecute'] },
        admin
      )
    ).state
    s = logon(s, id(s, 'PC1'), { user: 'jdupont', password: 'Azerty123!', domain: 'LAB' }).state
    const drive = mapDrive(s, id(s, 'PC1'), 'S', '\\\\SRV1\\Compta', sessionToken(s, id(s, 'PC1')))
    expect(drive.message).toBe('')
    return drive.state
  },
  'lab-06-wsus': (s) => {
    const srv = id(s, 'SRV1')
    const exec = (state: LabState, cmd: AnyCommand) => {
      const r = dispatch(state, cmd)
      if (!r.ok) throw new Error(`${cmd.type} : ${r.error.message}`)
      return r.state
    }
    s = unwrap(installFeatures(s, srv, ['UpdateServices'], { includeManagementTools: true })).state
    for (const cmd of [
      command('wsus.postInstall', srv, 'C:\\WSUS'),
      command('wsus.synchronize', srv),
      command('wsus.addGroup', srv, 'Postes'),
      command('wsus.setTargeting', srv, 'client'),
      command('wsus.approve', srv, 'KB9100102', 'Postes', true),
      command('gpo.createAndLink', 'lab.local', { name: 'GPO-WSUS' }, null)
    ])
      s = exec(s, cmd)
    const gpo = s.domains['lab.local']!.gpos.find((g) => g.name === 'GPO-WSUS')!
    s = unwrap(
      updateGpoSettings(s, 'lab.local', gpo.id, {
        computer: {
          wuServer: { state: 'Enabled', url: 'http://srv1.lab.local:8530' },
          wuTargetGroup: { state: 'Enabled', group: 'Postes' }
        }
      })
    ).state
    return run(s, id(s, 'PC1'), 'gpupdate /force', { shell: 'cmd' }).state
  },
  'lab-07-iis': (s) => {
    const srv = id(s, 'SRV1')
    const admin = domainToken(s.domains['lab.local'] as Domain, 'Administrateur')!
    s = unwrap(installFeatures(s, srv, ['Web-Server'], { includeManagementTools: true })).state
    s = unwrap(createItem(s, srv, 'C:\\Sites\\Intranet', 'folder', admin, { parents: true })).state
    s = unwrap(createItem(s, srv, 'C:\\Sites\\Intranet\\index.html', 'file', admin)).state
    for (const cmd of [
      command('iis.addSite', srv, {
        name: 'Intranet',
        physicalPath: 'C:\\Sites\\Intranet',
        binding: { port: 80, host: 'intranet.lab.local' }
      }),
      command('dns.addRecord', srv, 'lab.local', { name: 'intranet', type: 'CNAME', data: 'srv1.lab.local' })
    ]) {
      const r = dispatch(s, cmd)
      if (!r.ok) throw new Error(r.error.message)
      s = r.state
    }
    return s
  },
  'lab-08-rds': (s) => {
    const srv = id(s, 'SRV1')
    const pc1 = id(s, 'PC1')
    s = unwrap(installFeatures(s, srv, ['RDS-RD-Server'], { includeManagementTools: true })).state
    for (const cmd of [
      command('rds.addCollection', srv, { name: 'Bureautique', userGroups: ['LAB\\GG_Compta'] }),
      command('rds.addRemoteApp', srv, 'Bureautique', {
        displayName: 'Bloc-notes',
        filePath: 'C:\\Windows\\System32\\notepad.exe'
      }),
      command('rds.connect', pc1, {
        computer: 'srv1.lab.local',
        user: 'LAB\\jdupont',
        password: 'Azerty123!'
      }),
      command('rds.connect', pc1, {
        computer: 'srv1.lab.local',
        user: 'LAB\\pdurand',
        password: 'Azerty123!'
      })
    ]) {
      const r = dispatch(s, cmd)
      if (!r.ok) throw new Error(r.error.message)
      s = r.state
    }
    return s
  },
  'lab-09-hyperv': (s) => {
    const srv = id(s, 'SRV1')
    s = unwrap(installFeatures(s, srv, ['Hyper-V'], { includeManagementTools: true })).state
    for (const cmd of [
      command('hyperv.newSwitch', srv, { name: 'LAN-Test', type: 'Private' }),
      command('hyperv.newVm', srv, { name: 'VMTEST1', switchName: 'LAN-Test' }),
      command('hyperv.newVm', srv, { name: 'VMTEST2', switchName: 'LAN-Test' }),
      command('hyperv.newSwitch', srv, { name: 'Externe', type: 'External', netAdapter: 'Ethernet0' }),
      command('hyperv.newVm', srv, { name: 'VMWEB', switchName: 'Externe' }),
      command('hyperv.setVmState', srv, 'VMTEST1', true),
      command('hyperv.setVmState', srv, 'VMTEST2', true),
      command('hyperv.setVmState', srv, 'VMWEB', true)
    ]) {
      const r = dispatch(s, cmd)
      if (!r.ok) throw new Error(r.error.message)
      s = r.state
    }
    s = ip(s, 'VMTEST1', null, '192.168.50.1/24')
    s = ip(s, 'VMTEST2', null, '192.168.50.2/24')
    return ip(s, 'VMWEB', null, '192.168.10.50/24')
  },
  'lab-10-adcs': (s) => {
    const srv = id(s, 'SRV1')
    const exec = (cmd: AnyCommand) => {
      const r = dispatch(s, cmd)
      if (!r.ok) throw new Error(r.error.message)
      s = r.state
      return r.value
    }
    s = unwrap(
      installFeatures(s, srv, ['ADCS-Cert-Authority', 'Web-Server'], { includeManagementTools: true })
    ).state
    exec(command('adcs.install', srv, {}))
    const thumbprint = exec(
      command('adcs.request', srv, { template: 'WebServer', dnsNames: ['srv1.lab.local'] })
    )
    exec(
      command('iis.addBinding', srv, 'Default Web Site', {
        protocol: 'https',
        certificate: thumbprint as string
      })
    )
    const gpo = exec(command('gpo.createAndLink', 'lab.local', { name: 'PKI' }, null)) as string
    s = unwrap(updateGpoSettings(s, 'lab.local', gpo, { computer: { autoEnrollment: 'Enabled' } })).state
    return run(s, id(s, 'PC1'), 'gpupdate /force', { shell: 'cmd' }).state
  },
  'lab-11-dfs': (s) => {
    const admin = domainToken(s.domains['lab.local'] as Domain, 'Administrateur')!
    const exec = (cmd: AnyCommand) => {
      const r = dispatch(s, cmd)
      if (!r.ok) throw new Error(r.error.message)
      s = r.state
    }
    for (const name of ['SRV1', 'SRV2']) {
      const srv = id(s, name)
      s = unwrap(
        installFeatures(s, srv, ['FS-DFS-Namespace', 'FS-DFS-Replication'], { includeManagementTools: true })
      ).state
      exec(command('files.createItem', srv, 'C:\\Compta', 'folder', admin, {}))
      exec(
        command(
          'files.createShare',
          srv,
          { name: 'Compta', path: 'C:\\Compta', full: ['Tout le monde'] },
          admin
        )
      )
    }
    const ns = '\\\\lab.local\\Partages\\Compta'
    exec(command('dfs.newNamespace', id(s, 'SRV1'), { name: 'Partages', createShare: true }))
    exec(command('dfs.newFolder', ns, '\\\\SRV1\\Compta'))
    exec(command('dfs.addTarget', ns, '\\\\SRV2\\Compta'))
    exec(command('dfs.newGroup', id(s, 'SRV1'), 'RG-Compta'))
    exec(command('dfs.addMember', 'RG-Compta', 'SRV1'))
    exec(command('dfs.addMember', 'RG-Compta', 'SRV2'))
    exec(command('dfs.newReplicatedFolder', 'RG-Compta', 'Compta'))
    exec(
      command('dfs.setMembership', 'RG-Compta', 'Compta', 'SRV1', {
        contentPath: 'C:\\Compta',
        primary: true
      })
    )
    exec(command('dfs.setMembership', 'RG-Compta', 'Compta', 'SRV2', { contentPath: 'C:\\Compta' }))
    s = unwrap(createItem(s, id(s, 'SRV1'), 'C:\\Compta\\rapport.txt', 'file', admin)).state
    s = runBackgroundTasks(s).state
    return logon(s, id(s, 'PC1'), { user: 'jdupont', password: 'Azerty123!', domain: 'LAB' }).state
  }
}

describe('Labs', () => {
  const labs = [lab1, lab2, lab3, lab4, lab5, lab6, lab7, lab8, lab9, lab10, lab11].map(load)

  it('chaque lab a un identifiant unique, des critères uniques et des indices', () => {
    expect(new Set(labs.map((l) => l.id)).size).toBe(labs.length)
    for (const lab of labs) {
      expect(new Set(lab.criteria.map((c) => c.id)).size).toBe(lab.criteria.length)
      for (const c of lab.criteria) expect(c.hint.length).toBeGreaterThan(20)
    }
  })

  it('aucun indice ne donne la solution (valeur attendue par le critère)', () => {
    // Paramètres d'un critère qui sont la réponse attendue (les équipements visés restent nommables)
    const SOLUTION_KEYS = new Set([
      'address',
      'gateway',
      'start',
      'end',
      'router',
      'dnsServer',
      'data',
      'zone',
      'name',
      'memberOf',
      'parent',
      'path',
      'letter',
      'value',
      'setting',
      'gpo',
      'target',
      'domain',
      'to',
      'account'
    ])
    for (const lab of labs)
      for (const c of lab.criteria) {
        const answers = Object.entries(c.check)
          .filter(([key, value]) => SOLUTION_KEYS.has(key) && typeof value === 'string' && value.length >= 3)
          .map(([, value]) => (value as string).toLowerCase())
        for (const answer of answers)
          expect(c.hint.toLowerCase(), `${lab.id} › ${c.id} : l'indice contient « ${answer} »`).not.toContain(
            answer
          )
      }
  })

  for (const lab of labs) {
    it(`${lab.id} : départ incomplet, solution validée à 100 %`, () => {
      const start = buildLabStart(lab.start)
      const before = checkLab(start, lab)
      expect(before.passed).toBeLessThan(before.total)
      const solve = SOLUTIONS[lab.id]
      expect(solve).toBeDefined()
      const after = checkLab(solve!(start), lab)
      expect(after.results.filter((r) => !r.ok).map((r) => r.id)).toEqual([])
      expect(after.passed).toBe(after.total)
    })
  }

  it('le lab en cours est enregistré dans le .slab ; un fichier au format 2 reste lisible', () => {
    const state = buildLabStart(labs[0]!.start)
    const content = serializeSlab(state, {
      savedAt: '2026-10-05T10:00:00Z',
      appVersion: '0.1.0',
      meta: { labId: 'lab-01-adressage' }
    })
    const parsed = parseSlab(content)
    expect(parsed.ok && parsed.doc.meta.labId).toBe('lab-01-adressage')
    const old = JSON.parse(content)
    old.schemaVersion = 2
    delete old.meta.labId
    const migrated = parseSlab(JSON.stringify(old))
    expect(migrated.ok && migrated.doc.meta.labId).toBe('')
  })

  it('un lab invalide est refusé avec un message explicite', () => {
    const r = parseLab({ ...lab1, criteria: [] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('criteria')
  })
})
