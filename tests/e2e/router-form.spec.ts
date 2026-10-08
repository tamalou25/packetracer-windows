import { expect, test } from '@playwright/test'
import { launchApp, placeDevice } from './helpers'

test('Routeur : la saisie en cours survit à une autre modification de l’interface', async () => {
  const { close, page, consoleErrors } = await launchApp()
  try {
    await placeDevice(page, 'router', 300, 200)
    await page.getByTestId('device-R1').dblclick()
    const r1 = page.getByTestId('device-window-R1')
    await r1.getByTestId('nav-iface-Gi0/0').click()
    await r1.getByTestId('if-address').fill('192.168.10.254')
    await r1.getByTestId('if-mask').fill('255.255.255.0')
    // Désactiver l'interface pendant la saisie ne doit pas effacer l'adresse tapée
    await r1.getByTestId('if-enabled').uncheck()
    await expect(r1.getByTestId('if-address')).toHaveValue('192.168.10.254')
    await expect(r1.getByTestId('if-mask')).toHaveValue('255.255.255.0')

    // Changer d'interface affiche bien la configuration de la nouvelle (vide)
    await r1.getByTestId('nav-iface-Gi0/1').click()
    await expect(r1.getByTestId('if-address')).toHaveValue('')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
