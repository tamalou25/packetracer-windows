import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
import { clickMenu, launchApp } from './helpers'

/** Dépôt de bibliothèque simulé : index.json et labs/, servis en local. */
function libraryServer(): Promise<{ server: Server; url: string }> {
  const lab = readFileSync(resolve(__dirname, '../../labs/lab-02-dhcp.json'), 'utf8')
  const sha = createHash('sha256').update(lab, 'utf8').digest('hex')
  const entry = {
    title: 'DHCP partagé',
    author: 'Communauté',
    difficulty: 'Débutant',
    version: '1.2.0',
    summary: 'Distribuer des adresses.'
  }
  const index = {
    formatVersion: 1,
    labs: [
      { ...entry, id: 'lab-02-dhcp', file: 'labs/lab-02-dhcp.json', sha256: sha },
      // Empreinte qui ne correspond pas au fichier servi : refusé
      {
        ...entry,
        id: 'lab-altere',
        title: 'Lab altéré',
        file: 'labs/lab-altere.json',
        sha256: '0'.repeat(64)
      }
    ]
  }
  const files: Record<string, string> = {
    '/index.json': JSON.stringify(index),
    '/labs/lab-02-dhcp.json': lab,
    '/labs/lab-altere.json': lab
  }
  const server = createServer((req, res) => {
    const body = files[req.url ?? '']
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json; charset=utf-8' })
    res.end(body ?? '')
  })
  return new Promise((ok) =>
    server.listen(0, '127.0.0.1', () =>
      ok({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` })
    )
  )
}

test('Bibliothèque : index vérifié, lab téléchargé ouvert, lab altéré refusé', async () => {
  const { server, url } = await libraryServer()
  const { app, close, page, consoleErrors } = await launchApp({ env: { SERVERLAB_LIBRARY_URL: url } })
  try {
    await clickMenu(app, ['Fichier', 'Ouvrir un lab…'])
    await page.getByTestId('picker-tab-library').click()
    const library = page.getByTestId('library')
    await expect(library.getByTestId('library-entry-lab-02-dhcp')).toContainText('DHCP partagé')
    await expect(library.getByTestId('library-entry-lab-02-dhcp')).toContainText('v1.2.0')
    await expect(library.getByTestId('library-entry-lab-02-dhcp')).toContainText('par Communauté')

    await library.getByTestId('library-open-lab-altere').click()
    await expect(library.getByTestId('library-error')).toContainText('empreinte SHA-256 ne correspond pas')
    await expect(page.getByTestId('lab-picker')).toBeVisible()

    await library.getByTestId('library-open-lab-02-dhcp').click()
    await expect(page.getByTestId('lab-title')).toHaveText('Distribuer les adresses avec un serveur DHCP')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
    server.close()
  }
})

test('Bibliothèque injoignable : message clair et nouvel essai possible', async () => {
  // Port local fermé : aucune réponse
  const { app, close, page, consoleErrors } = await launchApp({
    env: { SERVERLAB_LIBRARY_URL: 'http://127.0.0.1:9/' }
  })
  try {
    await clickMenu(app, ['Fichier', 'Ouvrir un lab…'])
    await page.getByTestId('picker-tab-library').click()
    await expect(page.getByTestId('library-index-error')).toHaveText(
      'Bibliothèque injoignable : vérifiez la connexion Internet, puis réessayez.'
    )
    await expect(page.getByTestId('library-retry')).toBeVisible()
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
