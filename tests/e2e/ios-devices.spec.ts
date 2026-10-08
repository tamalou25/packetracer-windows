import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cableDevices, clickMenu, launchApp, placeDevice } from './helpers'

test('IOS : poser, câbler, ouvrir la console, enregistrer et rouvrir', async () => {
  const { app, close, page, consoleErrors, userData } = await launchApp()
  try {
    // Groupe Cisco de la palette
    await expect(page.getByTestId('palette').getByTestId('palette-c9200')).toBeVisible()
    await placeDevice(page, 'c1921', 260, 160)
    await placeDevice(page, 'c2960', 520, 300)
    await expect(page.getByTestId('device-R1')).toBeVisible()
    await expect(page.getByTestId('device-SW1')).toBeVisible()

    // Ports d'usine au survol (outil Câble) : Gi0/0 du routeur vers l'uplink Gi0/1 du switch
    await cableDevices(page, 'R1', 'Gi0/0', 'SW1', 'Gi0/1')
    await expect(page.locator('.react-flow__edge')).toHaveCount(1)

    // Double-clic : console IOS en mode utilisateur
    await page.getByTestId('device-R1').dblclick()
    const win = page.getByTestId('device-window-R1')
    await expect(win.getByTestId('console-ios')).toBeVisible()
    await expect(win.getByTestId('tab-config')).toHaveCount(0)
    await expect(win.getByTestId('terminal-ios')).toContainText('Press RETURN to get started!')
    await expect(win.getByTestId('terminal-ios')).toContainText('R1>')
    await win.getByTestId('close-device-window').click()

    // Enregistrement : modèles conservés
    const file = join(userData, 'cisco.slab')
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: path
      })) as typeof dialog.showSaveDialog
    }, file)
    await clickMenu(app, ['Fichier', 'Enregistrer sous…'])
    await expect(page).toHaveTitle('cisco.slab — ServerLab')
    const saved = JSON.parse(readFileSync(file, 'utf8')) as {
      lab: { devices: Record<string, { model?: string }> }
    }
    expect(
      Object.values(saved.lab.devices)
        .map((d) => d.model)
        .sort()
    ).toEqual(['c1921', 'c2960'])

    // Réouverture
    await clickMenu(app, ['Fichier', 'Nouveau'])
    await expect(page.locator('.react-flow__node')).toHaveCount(0)
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [path]
      })) as typeof dialog.showOpenDialog
    }, file)
    await clickMenu(app, ['Fichier', 'Ouvrir…'])
    await expect(page.locator('.react-flow__node')).toHaveCount(2)
    await page.getByTestId('device-SW1').dblclick()
    await expect(page.getByTestId('device-window-SW1').getByTestId('terminal-ios')).toContainText('SW1>')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
