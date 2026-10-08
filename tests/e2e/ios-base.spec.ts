import { expect, test } from '@playwright/test'
import { cableDevices, launchApp, placeDevice, typeCommand } from './helpers'

test('IOS : no shutdown câblé passe up/up, reload sans sauvegarde perd la configuration', async () => {
  const { close, page, consoleErrors } = await launchApp()
  try {
    await placeDevice(page, 'c1921', 260, 160)
    await placeDevice(page, 'c2960', 520, 300)
    await cableDevices(page, 'R1', 'Gi0/0', 'SW1', 'Fa0/1')
    await page.getByTestId('device-R1').dblclick()
    const term = page.getByTestId('device-window-R1').getByTestId('terminal-ios')
    for (const line of ['en', 'conf t', 'int g0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown'])
      await typeCommand(page, 'R1', line)
    await expect(term).toContainText(
      '%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/0, changed state to up'
    )
    await typeCommand(page, 'R1', 'end')
    await typeCommand(page, 'R1', 'show ip interface brief')
    await expect(term).toContainText(/GigabitEthernet0\/0\s+192\.168\.1\.1\s+YES manual up\s+up/)

    // reload : refus de sauvegarder, confirmation
    await typeCommand(page, 'R1', 'reload')
    await expect(term).toContainText('System configuration has been modified. Save? [yes/no]:')
    await typeCommand(page, 'R1', 'no')
    await expect(term).toContainText('Proceed with reload? [confirm]')
    await typeCommand(page, 'R1', '')
    await expect(term).toContainText('Press RETURN to get started!')
    await typeCommand(page, 'R1', 'show ip interface brief')
    await expect(term).toContainText(
      /GigabitEthernet0\/0\s+unassigned\s+YES unset\s+administratively down down/
    )
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
