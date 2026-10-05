import { expect, test } from '@playwright/test'
import { launchApp } from './helpers'

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

    // Bascule de mode
    await page.getByTestId('mode-simulation').click()
    await expect(page.getByTestId('mode-simulation')).toHaveAttribute('aria-checked', 'true')

    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
