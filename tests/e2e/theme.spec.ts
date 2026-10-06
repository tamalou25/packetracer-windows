import { expect, test, type ElectronApplication } from '@playwright/test'
import { clickMenu, launchApp, placeDevice } from './helpers'

/** Simule un changement de thème de l'OS (préférence lue par nativeTheme). */
async function setSystemDark(app: ElectronApplication, dark: boolean): Promise<void> {
  await app.evaluate(({ nativeTheme }, value) => {
    Object.defineProperty(nativeTheme, 'shouldUseDarkColors', { configurable: true, get: () => value })
    nativeTheme.emit('updated')
  }, dark)
}

/** Bouton radio coché dans Affichage > Thème. */
async function checkedTheme(app: ElectronApplication): Promise<string | undefined> {
  return app.evaluate(({ Menu }) => {
    const view = Menu.getApplicationMenu()?.items.find((i) => i.label.replace('&', '') === 'Affichage')
    const theme = view?.submenu?.items.find((i) => i.label === 'Thème')
    return theme?.submenu?.items.find((i) => i.checked)?.label
  })
}

test('Thème Système par défaut : suit l’OS en direct, Sombre et Clair l’ignorent', async () => {
  const first = await launchApp()
  try {
    const html = first.page.locator('html')
    await expect.poll(() => checkedTheme(first.app)).toBe('Système')
    await setSystemDark(first.app, true)
    await expect(html).toHaveAttribute('data-theme', 'dark')
    await setSystemDark(first.app, false)
    await expect(html).toHaveAttribute('data-theme', 'light')
    await setSystemDark(first.app, true)
    await expect(html).toHaveAttribute('data-theme', 'dark')

    // Choix explicite : l'OS n'est plus suivi
    await clickMenu(first.app, ['Affichage', 'Thème', 'Clair'])
    await expect(html).toHaveAttribute('data-theme', 'light')
    await expect.poll(() => checkedTheme(first.app)).toBe('Clair')
    await setSystemDark(first.app, true)
    await expect(html).toHaveAttribute('data-theme', 'light')

    // Le Bureau simulé garde son apparence claire quel que soit le thème
    await clickMenu(first.app, ['Affichage', 'Thème', 'Sombre'])
    await expect(html).toHaveAttribute('data-theme', 'dark')
    await placeDevice(first.page, 'server', 300, 200)
    await first.page.getByTestId('device-SRV1').dblclick()
    const win = first.page.getByTestId('device-window-SRV1')
    await win.getByTestId('tab-desktop').click()
    await expect(win.locator('[data-theme="light"]').first()).toBeVisible()
    expect(first.consoleErrors).toEqual([])
  } finally {
    await first.close()
  }

  // Préférence conservée au relancement
  const second = await launchApp({ userData: first.userData })
  try {
    await expect(second.page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect.poll(() => checkedTheme(second.app)).toBe('Sombre')
    await clickMenu(second.app, ['Affichage', 'Thème', 'Système'])
    await setSystemDark(second.app, false)
    await expect(second.page.locator('html')).toHaveAttribute('data-theme', 'light')
    expect(second.consoleErrors).toEqual([])
  } finally {
    await second.close()
  }
})

test('Aide > Raccourcis clavier : tous les raccourcis du menu, par groupe', async () => {
  const { app, close, page, consoleErrors } = await launchApp()
  try {
    await clickMenu(app, ['Aide', 'Raccourcis clavier'])
    const table = page.getByTestId('shortcuts-table')
    for (const text of ['Ctrl+L', 'Ctrl+Q', 'Ctrl+Maj+S', 'Ctrl+Maj+Z', 'F1', 'F11', 'Échap', 'Suppr'])
      await expect(table).toContainText(text)
    for (const group of ['Fichier', 'Édition', 'Outils du canvas', 'Affichage', 'Simulation', 'Aide'])
      await expect(table).toContainText(group)
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
