import { expect, test } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serializeSlab } from '../../src/engine/index'
import { domainLab, openLab } from './fixtures'
import { clickMenu, launchApp } from './helpers'

/** Contenus invalides et début du message attendu (toujours en français). */
function invalidFiles(): [string, string, RegExp][] {
  const valid = serializeSlab(domainLab(), { savedAt: '2026-10-06T10:00:00.000Z', appVersion: '2.0.0' })
  const doc = JSON.parse(valid) as Record<string, unknown>
  return [
    ['tronque.slab', valid.slice(0, valid.length / 3), /JSON illisible/],
    ['autre-appli.slab', JSON.stringify({ ...doc, app: 'AutreLogiciel' }), /n’a pas été créé par ServerLab/],
    ['futur.slab', JSON.stringify({ ...doc, schemaVersion: 99 }), /version plus récente de ServerLab/],
    ['vide.slab', '', /JSON illisible/]
  ]
}

test('ouvrir un .slab invalide : message en français, lab en cours conservé, aucune erreur', async () => {
  const { app, close, page, consoleErrors } = await launchApp()
  try {
    const lab = domainLab()
    await openLab(app, page, lab)
    const nodes = Object.keys(lab.devices).length
    // Lab ouvert puis modifié par les tâches de fond : « Ne pas enregistrer » avant chaque ouverture
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({
        response: 1,
        checkboxChecked: false
      })) as typeof dialog.showMessageBox
    })
    const dir = mkdtempSync(join(tmpdir(), 'serverlab-invalide-'))
    for (const [name, content, message] of invalidFiles()) {
      const file = join(dir, name)
      writeFileSync(file, content)
      await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = (async () => ({
          canceled: false,
          filePaths: [path]
        })) as typeof dialog.showOpenDialog
      }, file)
      await clickMenu(app, ['Fichier', 'Ouvrir…'])
      const modal = page.getByTestId('modal')
      await expect(modal).toContainText('Ouverture impossible')
      await expect(modal).toContainText(message)
      await modal.getByTestId('modal-confirm').click()
      await expect(modal).toHaveCount(0)
      await expect(page.locator('.react-flow__node')).toHaveCount(nodes)
    }
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
