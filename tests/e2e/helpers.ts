/**
 * Utilitaires E2E : lancement de l'application Electron construite (out/) dans un profil isolé.
 */
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export interface LaunchedApp {
  app: ElectronApplication
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
  return { app, page, consoleErrors, userData }
}
