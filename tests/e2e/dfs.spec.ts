import { expect, test } from '@playwright/test'
import { installFeatures, unwrap } from '../../src/engine/index'
import { domainLab, openLab } from './fixtures'
import { launchApp, openTool } from './helpers'

test('DFS : espace de noms de domaine créé dans la console, dossier et cible', async () => {
  let lab = domainLab()
  const srvId = Object.values(lab.devices).find((d) => d.name === 'SRV1')!.id
  lab = unwrap(
    installFeatures(lab, srvId, ['FS-DFS-Namespace', 'FS-DFS-Replication'], { includeManagementTools: true })
  ).state
  const { app, close, page, consoleErrors } = await launchApp()
  try {
    await openLab(app, page, lab)
    const srv = page.getByTestId('device-window-SRV1')
    await openTool(page, 'SRV1', 'dfsmgmt')
    const dfs = srv.getByTestId('app-dfsmgmt')
    await dfs.getByTestId('dfs-new-ns').click()
    await dfs.getByTestId('dfs-dialog').locator('input').first().fill('Partages')
    await dfs.getByTestId('dfs-dialog').getByRole('button', { name: 'OK' }).click()
    await expect(dfs.getByTestId('mmc-node-ns:Partages')).toContainText('\\\\lab.local\\Partages')

    // Dossier dont la cible est le partage racine (seul partage existant du lab)
    await dfs.getByTestId('mmc-node-ns:Partages').click()
    await dfs.getByTestId('dfs-new-folder').click()
    const inputs = dfs.getByTestId('dfs-dialog').locator('input')
    await inputs.nth(0).fill('Docs')
    await inputs.nth(1).fill('\\\\SRV1\\Partages')
    await dfs.getByTestId('dfs-dialog').getByRole('button', { name: 'OK' }).click()
    await expect(dfs.getByTestId('dfs-folders')).toContainText('\\\\SRV1\\Partages')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
