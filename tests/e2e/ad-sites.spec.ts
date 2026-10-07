import { expect, test } from '@playwright/test'
import { buildLabStart, parseLab } from '../../src/engine/index'
import sitesLab from '../../labs/lab-18-multi-sites.json'
import { openLab } from './fixtures'
import { launchApp, openTool } from './helpers'

test('Sites et services : renommer le site, créer site, sous-réseau et lien', async () => {
  const parsed = parseLab(sitesLab)
  if (!parsed.ok) throw new Error(parsed.message)
  const lab = buildLabStart(parsed.lab.start)
  const { app, close, page, consoleErrors } = await launchApp()
  try {
    await openLab(app, page, lab)
    const srv = page.getByTestId('device-window-SRV1')
    await openTool(page, 'SRV1', 'dssite')
    const c = srv.getByTestId('app-dssite')
    await c.getByTestId('mmc-node-site:Default-First-Site-Name').click()
    await c.getByTestId('dssite-rename').click()
    const rename = c.getByTestId('dssite-dialog')
    await rename.locator('input').nth(0).fill('Paris')
    await rename.getByRole('button', { name: 'OK' }).click()
    await c.getByTestId('dssite-new-site').click()
    await c.getByTestId('dssite-dialog').locator('input').nth(0).fill('Lyon')
    await c.getByTestId('dssite-dialog').getByRole('button', { name: 'OK' }).click()
    await c.getByTestId('dssite-new-subnet').click()
    const subnet = c.getByTestId('dssite-dialog')
    await subnet.locator('input').nth(0).fill('192.168.20.0/24')
    await subnet.locator('select').nth(0).selectOption('Lyon')
    await subnet.getByRole('button', { name: 'OK' }).click()
    await c.getByTestId('dssite-new-link').click()
    const link = c.getByTestId('dssite-dialog')
    await link.locator('input').nth(0).fill('Paris-Lyon')
    await link.locator('select').nth(0).selectOption('Paris')
    await link.locator('select').nth(1).selectOption('Lyon')
    await link.locator('input').nth(2).fill('15')
    await link.getByRole('button', { name: 'OK' }).click()
    await c.getByTestId('mmc-node-sites').click()
    await expect(c.getByTestId('dssite-sites')).toContainText('Paris')
    await expect(c.getByTestId('dssite-sites')).toContainText('192.168.20.0/24')
    await c.getByTestId('mmc-node-transports').click()
    await expect(c.getByTestId('dssite-links')).toContainText('Paris-Lyon')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
