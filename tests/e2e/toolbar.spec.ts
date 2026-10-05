import { expect, test } from '@playwright/test'
import { launchApp } from './helpers'

test('Barre d’outils : icônes, infobulles avec raccourci, raccourcis V / C / P / Suppr', async () => {
  const { close, page, consoleErrors } = await launchApp()
  try {
    const pressed = (tool: string) => page.getByTestId(`tool-${tool}`)
    await expect(pressed('select')).toHaveAttribute('aria-pressed', 'true')

    await page.getByTestId('tool-cable').hover()
    const tooltip = page.getByRole('tooltip').filter({ hasText: 'Câble' })
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText('C')

    await page.getByTestId('topology-canvas').click({ position: { x: 300, y: 300 } })
    await page.keyboard.press('c')
    await expect(pressed('cable')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('tool-hint')).toBeVisible()
    await page.keyboard.press('p')
    await expect(pressed('pdu')).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('v')
    await expect(pressed('select')).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Delete')
    await expect(pressed('delete')).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Escape')
    await expect(pressed('select')).toHaveAttribute('aria-pressed', 'true')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
