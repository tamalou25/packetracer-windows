import { expect, test } from '@playwright/test'
import { clickMenu, launchApp } from './helpers'

test('l’application démarre avec une fenêtre sécurisée', async () => {
  const { app, close, page, consoleErrors } = await launchApp()
  try {
    await expect(page).toHaveTitle(/ServerLab/)
    await expect(page.getByTestId('topology-canvas')).toBeVisible()
    await expect(page.getByTestId('palette-server')).toBeVisible()
    await expect(page.getByTestId('properties-panel')).toBeVisible()

    // Sécurité : pas d'accès Node dans le renderer, API minimale exposée
    const exposed = await page.evaluate(() => ({
      require: typeof (globalThis as { require?: unknown }).require,
      process: typeof (globalThis as { process?: unknown }).process,
      api: Object.keys(window.serverlab).sort()
    }))
    expect(exposed.require).toBe('undefined')
    expect(exposed.process).toBe('undefined')
    expect(exposed.api).toContain('onMenuCommand')

    // Menu natif en français
    const menuLabels = await app.evaluate(({ Menu }) =>
      (Menu.getApplicationMenu()?.items ?? []).map((i) => i.label.replace('&', ''))
    )
    expect(menuLabels).toEqual(['Fichier', 'Édition', 'Affichage', 'Simulation', 'Aide'])

    // Aide > Rechercher des mises à jour : hors application installée, un dialogue l'explique
    await app.evaluate(({ dialog }) => {
      const messages: string[] = []
      ;(globalThis as { updateDialogs?: string[] }).updateDialogs = messages
      dialog.showMessageBox = (async (...args: unknown[]) => {
        const options = args.find(
          (a): a is Electron.MessageBoxOptions => !!a && typeof a === 'object' && 'message' in a
        )
        messages.push(options?.message ?? '')
        return { response: 1, checkboxChecked: false }
      }) as typeof dialog.showMessageBox
    })
    await clickMenu(app, ['Aide', 'Rechercher des mises à jour…'])
    await expect
      .poll(() => app.evaluate(() => (globalThis as { updateDialogs?: string[] }).updateDialogs ?? []))
      .toEqual(['Mises à jour automatiques indisponibles pour cette copie.'])

    // Bascule de mode
    await page.getByTestId('mode-simulation').click()
    await expect(page.getByTestId('mode-simulation')).toHaveAttribute('aria-checked', 'true')

    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
