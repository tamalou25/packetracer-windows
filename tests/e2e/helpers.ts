/**
 * Utilitaires E2E : lancement de l'application Electron construite (out/) dans un profil isolé.
 */
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
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

export async function launchApp(options: { userData?: string } = {}): Promise<LaunchedApp> {
  // Profil réutilisable pour vérifier la persistance des préférences entre deux lancements
  const userData = options.userData ?? mkdtempSync(join(tmpdir(), 'serverlab-e2e-'))
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

/** Configure l'adresse IPv4 statique d'un serveur/poste via sa fenêtre (onglet Config). */
export async function configureHostIp(
  page: Page,
  device: string,
  ip: string,
  mask: string,
  gateway = '',
  dns = ''
): Promise<void> {
  await page.getByTestId(`device-${device}`).dblclick()
  const win = page.getByTestId(`device-window-${device}`)
  await win.getByTestId('nav-iface-Ethernet0').click()
  await win.getByTestId('ip-static').check()
  await win.getByTestId('ip-address').fill(ip)
  await win.getByTestId('ip-mask').fill(mask)
  await win.getByTestId('ip-gateway').fill(gateway)
  await win.getByTestId('ip-dns1').fill(dns)
  await win.getByTestId('ip-apply').click()
  await expect(win.getByTestId('ip-effective')).toHaveText(ip)
  await win.getByTestId('close-device-window').click()
}

/** Ouvre l'onglet Console d'un équipement et choisit l'interpréteur. */
export async function openConsole(page: Page, device: string, shell: 'cmd' | 'powershell'): Promise<void> {
  const win = page.getByTestId(`device-window-${device}`)
  if ((await win.count()) === 0) await page.getByTestId(`device-${device}`).dblclick()
  await win.getByTestId('tab-console').click()
  await win.getByTestId(`console-${shell}`).click()
}

/** Ouvre l'onglet Bureau d'un équipement ; renvoie la fenêtre de l'équipement. */
export async function openDesktop(page: Page, device: string) {
  const win = page.getByTestId(`device-window-${device}`)
  if ((await win.count()) === 0) await page.getByTestId(`device-${device}`).dblclick()
  await win.getByTestId('tab-desktop').click()
  await expect(win.getByTestId('taskbar')).toBeVisible()
  return win
}

/** Lance un outil d'administration depuis le menu Outils du Gestionnaire de serveur. */
export async function openTool(page: Page, device: string, tool: string): Promise<void> {
  const win = await openDesktop(page, device)
  await win.getByTestId('app-servermanager').getByTestId('sm-tools').click()
  await win.getByTestId(`sm-tool-${tool}`).click()
  await expect(win.getByTestId(`app-${tool}`)).toBeVisible()
}

/** Déverrouille ou ouvre la session de l'écran de verrouillage (Ctrl+Alt+Suppr puis mot de passe). */
export async function unlock(page: Page, device: string, password: string, user?: string): Promise<void> {
  const win = page.getByTestId(`device-window-${device}`)
  await win.getByTestId('send-cad').click()
  if (user) await win.getByTestId('logon-user').fill(user)
  await win.getByTestId('logon-password').fill(password)
  await win.getByTestId('logon-submit').click()
}

/** Tape une commande dans la console visible et valide. */
export async function typeCommand(page: Page, device: string, command: string): Promise<void> {
  const input = page.getByTestId(`device-window-${device}`).getByTestId('terminal-input')
  await input.fill(command)
  await input.press('Enter')
}
