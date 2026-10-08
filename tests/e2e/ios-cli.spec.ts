import { expect, test } from '@playwright/test'
import { launchApp, placeDevice, typeCommand } from './helpers'

test('IOS : modes, aide ?, Tab, Ctrl+Z, erreurs', async () => {
  const { close, page, consoleErrors } = await launchApp()
  try {
    await placeDevice(page, 'c1921', 300, 200)
    await page.getByTestId('device-R1').dblclick()
    const win = page.getByTestId('device-window-R1')
    const term = win.getByTestId('terminal-ios')
    const input = win.getByTestId('terminal-input')

    // Abréviation ambiguë puis mode privilégié
    await typeCommand(page, 'R1', 'e')
    await expect(term).toContainText('% Ambiguous command: "e"')
    await typeCommand(page, 'R1', 'en')
    await expect(term).toContainText('R1#')

    // Tab complète « conf » ; ? affiche l'aide sans valider la ligne
    await input.fill('conf')
    await input.press('Tab')
    await expect(input).toHaveValue('configure ')
    await input.press('?')
    await expect(term).toContainText('terminal  Configure from the terminal')
    await expect(input).toHaveValue('configure ')
    await input.fill('configure terminal')
    await input.press('Enter')
    await expect(term).toContainText('Enter configuration commands, one per line.  End with CNTL/Z.')

    // Sous-mode d'interface, erreur avec marqueur, Ctrl+Z
    await typeCommand(page, 'R1', 'int g0/9')
    await expect(term).toContainText("% Invalid input detected at '^' marker.")
    await typeCommand(page, 'R1', 'int g0/0')
    await expect(term).toContainText('R1(config-if)#')
    await typeCommand(page, 'R1', 'interface')
    await expect(term).toContainText('% Incomplete command.')
    await input.press('Control+z')
    await expect(term).toContainText('R1(config-if)#^Z')
    await expect(term).toContainText('%SYS-5-CONFIG_I: Configured from console by console')
    await expect(win.locator('span.whitespace-pre').last()).toHaveText('R1#')

    // Historique : flèche haut
    await input.press('ArrowUp')
    await expect(input).toHaveValue('interface')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
