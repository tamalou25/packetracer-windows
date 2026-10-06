/**
 * Tutoriel interactif « premier ping » : parcours complet validé par l'état réel du lab (pas de
 * bouton Suivant), zones mises en évidence, préférence enregistrée, relance depuis Aide.
 */
import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  cableDevices,
  clickMenu,
  configureHostIp,
  launchApp,
  openConsole,
  placeDevice,
  typeCommand
} from './helpers'

const card = (page: Page) => page.getByTestId('tutorial-card')
const step = (page: Page) => page.getByTestId('tutorial-step')
const spotlight = (page: Page) => page.getByTestId('tutorial-spotlight')
const target = (id: string) => `[data-testid="${id}"]`
const settings = (userData: string) =>
  JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as Record<string, unknown>

test('premier lancement : parcours complet jusqu’au premier ping', async () => {
  // Profil vierge : accueil et tutoriel proposés, comme pour un nouvel utilisateur
  const { app, close, page, consoleErrors, userData } = await launchApp({ home: true, tutorial: true })
  try {
    await expect(page.getByTestId('home-screen')).toBeVisible()
    await expect(card(page)).toHaveAttribute('data-phase', 'welcome')
    await page.getByTestId('tutorial-start').click()
    await expect(page.getByTestId('home-screen')).toHaveCount(0)
    await expect(card(page)).toHaveAttribute('data-phase', 'running')

    // 1-2. Placer un serveur puis un poste : la palette, puis le canvas une fois l'équipement armé
    await expect(step(page)).toHaveAttribute('data-step', 'place-server')
    await expect(spotlight(page)).toHaveAttribute('data-target', target('palette-server'))
    await page.getByTestId('palette-server').click()
    await expect(spotlight(page)).toHaveAttribute('data-target', target('topology-canvas'))
    await page
      .getByTestId('topology-canvas')
      .locator('.react-flow__pane')
      .click({ position: { x: 220, y: 160 } })
    await expect(step(page)).toHaveAttribute('data-step', 'place-client')
    await expect(spotlight(page)).toHaveAttribute('data-target', target('palette-client'))
    await placeDevice(page, 'client', 480, 160)

    // 3. Câbler : l'outil Câble, puis le serveur
    await expect(step(page)).toHaveAttribute('data-step', 'cable')
    await expect(spotlight(page)).toHaveAttribute('data-target', target('tool-cable'))
    await page.getByTestId('tool-cable').click()
    await expect(spotlight(page)).toHaveAttribute('data-target', target('device-SRV1'))
    await page.getByTestId('tool-select').click()
    await cableDevices(page, 'SRV1', 'Ethernet0', 'PC1', 'Ethernet0')

    // 4. Les hôtes se joignent déjà en APIPA : l'étape exige une adresse fixe
    await expect(step(page)).toHaveAttribute('data-step', 'ip-server')
    await expect(spotlight(page)).toHaveAttribute('data-target', target('device-SRV1'))
    await configureHostIp(page, 'SRV1', '192.168.1.1', '255.255.255.0')

    // 5. Le poste dans le même réseau (adresse proposée par la consigne)
    await expect(step(page)).toHaveAttribute('data-step', 'ip-client')
    await page.getByTestId('device-PC1').dblclick()
    await expect(page.getByTestId('tutorial-instruction')).toContainText('192.168.1.10')
    await page.getByTestId('device-window-PC1').getByTestId('close-device-window').click()
    await configureHostIp(page, 'PC1', '192.168.1.10', '255.255.255.0')

    // 6. Ping depuis la console du poste
    await expect(step(page)).toHaveAttribute('data-step', 'ping')
    await expect(spotlight(page)).toHaveAttribute('data-target', target('device-PC1'))
    await openConsole(page, 'PC1', 'cmd')
    await expect(page.getByTestId('tutorial-instruction')).toContainText('ping 192.168.1.1')
    await typeCommand(page, 'PC1', 'ping 192.168.1.1')

    await expect(card(page)).toHaveAttribute('data-phase', 'done')
    await expect(page.getByTestId('tutorial-done')).toContainText('PC1')
    await expect.poll(() => settings(userData)['showTutorialOnStartup']).toBe(false)
    await page.getByTestId('tutorial-finish').click()
    await expect(card(page)).toHaveCount(0)

    // Le tutoriel est terminé : plus proposé au démarrage, toujours accessible depuis Aide
    await clickMenu(app, ['Aide', 'Tutoriel interactif'])
    await expect(card(page)).toHaveAttribute('data-phase', 'welcome')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})

test('passer et désactiver ; relancer depuis Aide ; quitter puis recommencer', async () => {
  const first = await launchApp({ tutorial: true })
  try {
    await expect(card(first.page)).toHaveAttribute('data-phase', 'welcome')
    await first.page.getByTestId('tutorial-at-startup').uncheck()
    await first.page.getByTestId('tutorial-skip').click()
    await expect(card(first.page)).toHaveCount(0)
    await expect.poll(() => settings(first.userData)['showTutorialOnStartup']).toBe(false)
  } finally {
    await first.close()
  }

  const { app, close, page } = await launchApp({ userData: first.userData })
  try {
    await expect(page.getByTestId('topology-canvas')).toBeVisible()
    // Laisse au démarrage le temps de lire la préférence avant de vérifier l'absence de carte
    await page.waitForTimeout(500)
    await expect(card(page)).toHaveCount(0)

    await clickMenu(app, ['Aide', 'Tutoriel interactif'])
    await page.getByTestId('tutorial-start').click()
    await expect(step(page)).toHaveAttribute('data-step', 'place-server')

    // Lab préparé rapidement, puis ping par l'outil PDU simple (poste → serveur)
    await placeDevice(page, 'server', 220, 160)
    await placeDevice(page, 'client', 480, 160)
    await cableDevices(page, 'SRV1', 'Ethernet0', 'PC1', 'Ethernet0')
    await configureHostIp(page, 'SRV1', '10.0.0.1', '255.0.0.0')
    await configureHostIp(page, 'PC1', '10.0.0.2', '255.0.0.0')
    await expect(step(page)).toHaveAttribute('data-step', 'ping')

    // Quitter puis revenir : la progression suit l'état du lab, le ping reste à faire
    await page.getByTestId('tutorial-quit').click()
    await expect(card(page)).toHaveCount(0)
    await clickMenu(app, ['Aide', 'Tutoriel interactif'])
    await expect(card(page)).toHaveAttribute('data-phase', 'welcome')
    await page.getByTestId('tutorial-skip').click()

    await page.getByTestId('tool-pdu').click()
    await page.getByTestId('device-PC1').click()
    await page.getByTestId('device-SRV1').click()
    await expect(page.getByTestId('pdu-list')).toContainText('Réussi')
    // Relancé : « Commencer » propose d'enregistrer le lab en cours, puis repart d'un lab vide
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({
        response: 1,
        checkboxChecked: false
      })) as typeof dialog.showMessageBox
    })
    await clickMenu(app, ['Aide', 'Tutoriel interactif'])
    await page.getByTestId('tutorial-start').click()
    await expect(page.locator('.react-flow__node')).toHaveCount(0)
    await expect(step(page)).toHaveAttribute('data-step', 'place-server')
  } finally {
    await close()
  }
})

test('ping par l’outil PDU simple : étape validée', async () => {
  const { close, page } = await launchApp({ tutorial: true })
  try {
    await page.getByTestId('tutorial-start').click()
    await placeDevice(page, 'server', 220, 160)
    await placeDevice(page, 'client', 480, 160)
    await cableDevices(page, 'SRV1', 'Ethernet0', 'PC1', 'Ethernet0')
    await configureHostIp(page, 'SRV1', '172.16.0.1', '255.255.0.0')
    await configureHostIp(page, 'PC1', '172.16.0.20', '255.255.0.0')
    await expect(step(page)).toHaveAttribute('data-step', 'ping')

    await page.getByTestId('tool-pdu').click()
    await page.getByTestId('device-PC1').click()
    await page.getByTestId('device-SRV1').click()
    await expect(card(page)).toHaveAttribute('data-phase', 'done')
  } finally {
    await close()
  }
})
