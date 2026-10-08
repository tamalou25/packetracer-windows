import { expect, test } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serializeSlab } from '../../src/engine/index'
import { domainLab } from './fixtures'
import { launchApp } from './helpers'

/** Profil sans accueil ni tutoriel, avec un fichier de récupération automatique donné. */
function profileWithRecovery(content: string): { userData: string; recovery: string } {
  const userData = mkdtempSync(join(tmpdir(), 'serverlab-e2e-'))
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({ language: 'fr', showHomeOnStartup: false, showTutorialOnStartup: false })
  )
  mkdirSync(join(userData, 'autosave'))
  const recovery = join(userData, 'autosave', 'recovery.slab')
  writeFileSync(recovery, content)
  return { userData, recovery }
}

test('récupération : fichier corrompu ignoré et supprimé, sans erreur ni dialogue', async () => {
  const lab = serializeSlab(domainLab(), { savedAt: '2026-10-05T10:00:00.000Z', appVersion: '2.0.0' })
  // Fichier tronqué au milieu : JSON illisible
  const { userData, recovery } = profileWithRecovery(lab.slice(0, Math.floor(lab.length / 2)))
  const { close, page, consoleErrors } = await launchApp({ userData })
  try {
    await expect(page.locator('.react-flow__pane')).toBeVisible()
    await expect.poll(() => existsSync(recovery)).toBe(false)
    await expect(page.getByTestId('modal')).toHaveCount(0)
    await expect(page.locator('.react-flow__node')).toHaveCount(0)
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})

test('récupération : fichier valide proposé puis restauré', async () => {
  const lab = domainLab()
  const { userData } = profileWithRecovery(
    serializeSlab(lab, { savedAt: '2026-10-05T10:00:00.000Z', appVersion: '2.0.0' })
  )
  const { close, page, consoleErrors } = await launchApp({ userData })
  try {
    const modal = page.getByTestId('modal')
    await expect(modal).toContainText('ne s’est pas fermé correctement')
    await modal.getByTestId('modal-confirm').click()
    await expect(page.locator('.react-flow__node')).toHaveCount(Object.keys(lab.devices).length)
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
