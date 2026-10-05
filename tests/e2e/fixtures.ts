/**
 * Labs préparés pour les scénarios E2E : construits avec le moteur (mêmes actions que l'interface),
 * enregistrés en .slab puis ouverts dans l'application (dialogue d'ouverture simulé).
 */
import { expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addDevice,
  addGroup,
  addGroupMembers,
  addOrganizationalUnit,
  addUser,
  connect,
  createLab,
  installFeatures,
  installForest,
  joinDomain,
  restartComputer,
  serializeSlab,
  setInterfaceIpv4,
  unwrap,
  type DeviceKind,
  type LabState
} from '../../src/engine/index'
import { clickMenu } from './helpers'

/** Domaine prêt à l'emploi : SRV1 (contrôleur lab.local), PC1 joint, OU Compta (jdupont, mmartin, GG_Compta). */
export function domainLab(): LabState {
  let s = createLab()
  const add = (kind: DeviceKind, name: string, x: number, y: number) => {
    const r = unwrap(addDevice(s, { kind, position: { x, y }, name }))
    s = r.state
    return r.value
  }
  const srv = add('server', 'SRV1', 220, 160)
  const pc = add('client', 'PC1', 560, 160)
  const sw = add('switch', 'SW1', 390, 320)
  const port = (id: string, i: number) => ({ deviceId: id, ifaceId: s.devices[id]?.interfaces[i]?.id ?? '' })
  s = unwrap(connect(s, port(srv, 0), port(sw, 0))).state
  s = unwrap(connect(s, port(pc, 0), port(sw, 1))).state
  const ip = (id: string, address: string, dns: string) => {
    s = unwrap(
      setInterfaceIpv4(s, id, port(id, 0).ifaceId, {
        addressing: 'static',
        address,
        mask: '24',
        gateway: null,
        dnsServers: [dns]
      })
    ).state
  }
  ip(srv, '192.168.1.1', '8.8.8.8')
  ip(pc, '192.168.1.10', '192.168.1.1')
  s = unwrap(installFeatures(s, srv, ['AD-Domain-Services'], { includeManagementTools: true })).state
  s = unwrap(installForest(s, srv, { domainName: 'lab.local', safeModePassword: 'P@ssw0rd!' })).state
  const joined = joinDomain(s, pc, { domain: 'lab.local', user: 'LAB\\Administrateur', password: 'P@ssw0rd' })
  s = unwrap(restartComputer(joined.state, pc)).state
  s = unwrap(addOrganizationalUnit(s, 'lab.local', { name: 'Compta' })).state
  for (const [name, sam] of [
    ['Jean Dupont', 'jdupont'],
    ['Marie Martin', 'mmartin']
  ] as const)
    s = unwrap(
      addUser(s, 'lab.local', {
        name,
        sam,
        path: 'OU=Compta,DC=lab,DC=local',
        password: 'Azerty123!',
        enabled: true
      })
    ).state
  // GG_Compta : groupe global de jdupont (mmartin n'en fait pas partie)
  s = unwrap(
    addGroup(s, 'lab.local', { name: 'GG_Compta', scope: 'Global', path: 'OU=Compta,DC=lab,DC=local' })
  ).state
  s = unwrap(addGroupMembers(s, 'lab.local', 'GG_Compta', ['jdupont'])).state
  return s
}

/** Enregistre le lab dans un fichier .slab temporaire et l'ouvre (Fichier > Ouvrir…). */
export async function openLab(app: ElectronApplication, page: Page, lab: LabState): Promise<void> {
  const file = join(mkdtempSync(join(tmpdir(), 'serverlab-lab-')), 'lab.slab')
  writeFileSync(file, serializeSlab(lab, { savedAt: '2026-10-05T10:00:00.000Z', appVersion: '0.1.0' }))
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [path]
    })) as typeof dialog.showOpenDialog
  }, file)
  await clickMenu(app, ['Fichier', 'Ouvrir…'])
  await expect(page.locator('.react-flow__node')).toHaveCount(Object.keys(lab.devices).length)
}
