/**
 * Utilitaires E2E : lancement de l'application Electron construite (out/) dans un profil isolé.
 */
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export interface LaunchedApp {
  app: ElectronApplication
  /** Ferme l'application sans enregistrer (répond « Ne pas enregistrer » si besoin). */
  close: () => Promise<void>
  page: Page
  /** Erreurs console capturées (ex. violations CSP). */
  consoleErrors: string[]
  userData: string
}

export async function launchApp(): Promise<LaunchedApp> {
  const userData = mkdtempSync(join(tmpdir(), 'serverlab-e2e-'))
  const app = await electron.launch({
    args: [resolve(__dirname, '../../out/main/index.js'), '--no-sandbox'],
    env: { ...process.env, SERVERLAB_USER_DATA: userData, NODE_ENV: 'production' }
  })
  const page = await app.firstWindow()
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(err.message))
  await page.waitForLoadState('domcontentloaded')
  const close = async () => {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({
        response: 1,
        checkboxChecked: false
      })) as typeof dialog.showMessageBox
    })
    await app.close()
  }
  return { app, close, page, consoleErrors, userData }
}

/** Déclenche un élément du menu natif, ex. ['Fichier', 'Enregistrer sous…']. */
export async function clickMenu(app: ElectronApplication, path: string[]): Promise<void> {
  await app.evaluate(({ Menu, BrowserWindow }, labels) => {
    let items = Menu.getApplicationMenu()?.items ?? []
    let target: Electron.MenuItem | undefined
    for (const label of labels) {
      target = items.find((i) => i.label.replace('&', '') === label)
      if (!target) throw new Error(`Menu introuvable : ${label}`)
      items = target.submenu?.items ?? []
    }
    const win = BrowserWindow.getAllWindows()[0]
    target?.click(undefined, win, win?.webContents)
  }, path)
}

/** Place un équipement de la palette à une position relative au canvas. */
export async function placeDevice(page: Page, kind: string, x: number, y: number): Promise<void> {
  await page.getByTestId(`palette-${kind}`).click()
  await page.getByTestId('topology-canvas').locator('.react-flow__pane').click({ position: { x, y } })
}

/** Relie deux équipements avec l'outil Câble. */
export async function cableDevices(
  page: Page,
  a: string,
  portA: string,
  b: string,
  portB: string
): Promise<void> {
  await page.getByTestId('tool-cable').click()
  await page.getByTestId(`device-${a}`).click()
  await page.getByTestId('port-picker').getByTestId(`port-${portA}`).click()
  await page.getByTestId(`device-${b}`).click()
  await page.getByTestId('port-picker').getByTestId(`port-${portB}`).click()
  await page.getByTestId('tool-select').click()
}
