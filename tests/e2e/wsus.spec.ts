import { expect, test } from '@playwright/test'
import { launchApp, openConsole, openTool, placeDevice, typeCommand } from './helpers'

test('WSUS : installation, post-installation, synchronisation et approbation dans la console', async () => {
  const { close, page, consoleErrors } = await launchApp()
  try {
    await placeDevice(page, 'server', 260, 220)
    await openConsole(page, 'SRV1', 'powershell')
    await typeCommand(page, 'SRV1', 'Install-WindowsFeature UpdateServices -IncludeManagementTools')
    const srv = page.getByTestId('device-window-SRV1')
    await expect(srv.getByTestId('terminal-powershell')).toContainText('Services WSUS')

    await openTool(page, 'SRV1', 'wsus')
    await srv.getByTestId('wsus-content-dir').fill('C:\\WSUS')
    await srv.getByRole('button', { name: 'Exécuter' }).click()
    await expect(srv.getByTestId('wsus-console')).toBeVisible()

    // Groupe d'ordinateurs, synchronisation, approbation pour le groupe
    await srv.getByTestId('mmc-node-group:Tous les ordinateurs').click()
    await srv.getByTestId('wsus-new-group').click()
    await srv.getByTestId('wsus-group-dialog').locator('input').first().fill('Postes')
    await srv.getByTestId('wsus-group-dialog').getByRole('button', { name: 'Ajouter' }).click()
    await srv.getByTestId('wsus-sync').click()
    await srv.getByTestId('mmc-node-updates:all').click()
    await expect(srv.getByTestId('wsus-updates')).toContainText('KB9100102')
    await srv.getByTestId('wsus-approve-group').selectOption('Postes')
    await srv.getByTestId('wsus-approve-KB9100102').click()
    await expect(srv.getByTestId('wsus-updates')).toContainText('Installer (Postes)')

    // Même état vu par PowerShell
    await openConsole(page, 'SRV1', 'powershell')
    await typeCommand(page, 'SRV1', '(Get-WsusUpdate -Approval Approved).UpdateId')
    await expect(srv.getByTestId('terminal-powershell')).toContainText('KB9100102')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
