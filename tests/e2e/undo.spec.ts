import { expect, test } from '@playwright/test'
import { launchApp, openConsole, placeDevice, typeCommand } from './helpers'

test('Annuler / rétablir : ajout, glisser (une seule annulation) et commande console', async () => {
  const { close, page, consoleErrors } = await launchApp()
  try {
    await placeDevice(page, 'server', 250, 150)
    await placeDevice(page, 'client', 250, 380)
    await expect(page.locator('.react-flow__node')).toHaveCount(2)

    // Glisser : plusieurs déplacements intermédiaires, une seule entrée dans le journal
    const node = page.getByTestId('device-PC1')
    const before = await node.boundingBox()
    await node.hover()
    await page.mouse.down()
    for (let i = 1; i <= 5; i++) await page.mouse.move(before!.x + 20 + i * 30, before!.y + 20 + i * 10)
    await page.mouse.up()
    await expect.poll(async () => (await node.boundingBox())?.x).toBeGreaterThan(before!.x + 100)
    await page.locator('.react-flow__pane').click({ position: { x: 700, y: 60 } })
    await page.keyboard.press('Control+z')
    await expect.poll(async () => Math.round((await node.boundingBox())?.x ?? 0)).toBe(Math.round(before!.x))
    await expect(page.locator('.react-flow__node')).toHaveCount(2)
    await page.keyboard.press('Control+z')
    await expect(page.locator('.react-flow__node')).toHaveCount(1)
    await page.keyboard.press('Control+y')
    await expect(page.locator('.react-flow__node')).toHaveCount(2)

    // Commande console : l'adresse affichée sur le nœud disparaît puis revient
    await openConsole(page, 'SRV1', 'powershell')
    await typeCommand(
      page,
      'SRV1',
      'New-NetIPAddress -InterfaceAlias Ethernet0 -IPAddress 192.168.10.1 -PrefixLength 24'
    )
    await page.getByTestId('close-device-window').click()
    const srv = page.getByTestId('device-SRV1')
    await expect(srv).toContainText('192.168.10.1')
    await page.locator('.react-flow__pane').click({ position: { x: 700, y: 60 } })
    await page.keyboard.press('Control+z')
    await expect(srv).not.toContainText('192.168.10.1')
    await page.keyboard.press('Control+y')
    await expect(srv).toContainText('192.168.10.1')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
