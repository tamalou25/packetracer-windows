import { expect, test } from '@playwright/test'
import { launchApp, openConsole, openTool, placeDevice, typeCommand } from './helpers'

test('Hyper-V : commutateur privé et machine virtuelle créés dans le Gestionnaire, visibles sur le canvas', async () => {
  const { close, page, consoleErrors } = await launchApp()
  try {
    await placeDevice(page, 'server', 260, 160)
    await openConsole(page, 'SRV1', 'powershell')
    await typeCommand(page, 'SRV1', 'Install-WindowsFeature Hyper-V -IncludeManagementTools')
    const srv = page.getByTestId('device-window-SRV1')
    await expect(srv.getByTestId('terminal-powershell')).toContainText('Hyper-V')

    await openTool(page, 'SRV1', 'hypervmgr')
    // Commutateur privé
    await srv.getByTestId('hv-new-switch').click()
    const sw = srv.getByTestId('hv-switch-dialog')
    await sw.locator('input').first().fill('Privé')
    await sw.locator('select').first().selectOption('Private')
    await sw.getByRole('button', { name: 'OK' }).click()
    // Ordinateur virtuel connecté au commutateur
    await srv.getByTestId('hv-new-vm').click()
    const vm = srv.getByTestId('hv-vm-dialog')
    await vm.locator('input').first().fill('VM1')
    await vm.locator('select').last().selectOption('Privé')
    await vm.getByRole('button', { name: 'Terminer' }).click()
    await expect(srv.getByTestId('hv-vms')).toContainText('VM1')
    await expect(srv.getByTestId('hv-switch-VM1')).toHaveValue('Privé')
    await srv.getByTestId('hv-power-VM1').click()
    await expect(srv.getByTestId('hv-vms')).toContainText('Exécution')
    await srv.getByTestId('close-device-window').click()

    // Canvas : la VM et le commutateur virtuel apparaissent, marqués comme virtuels
    await expect(page.getByTestId('device-VM1').getByTestId('device-virtual')).toHaveText('VM')
    await expect(page.getByTestId('device-Privé (SRV1)').getByTestId('device-virtual')).toHaveText('vSW')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
