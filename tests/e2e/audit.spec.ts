import { expect, test } from '@playwright/test'
import { addDevice, createLab, setSmb1, unwrap } from '../../src/engine/index'
import { openLab } from './fixtures'
import { launchApp } from './helpers'

test('Audit : score et recommandation SMB 1.0 (objet et correction)', async () => {
  let lab = createLab()
  const added = unwrap(addDevice(lab, { kind: 'server', position: { x: 200, y: 200 }, name: 'SRV1' }))
  lab = unwrap(setSmb1(added.state, added.value, true)).state
  const { app, close, page, consoleErrors } = await launchApp()
  try {
    await openLab(app, page, lab)
    await page.getByTestId('right-tab-audit').click()
    const panel = page.getByTestId('audit-panel')
    await expect(panel.getByTestId('audit-score')).toContainText('75')
    await expect(panel.getByTestId('audit-smb1')).toContainText('SMB 1.0')
    await expect(panel.getByTestId('audit-smb1')).toContainText('Set-SmbServerConfiguration')
    expect(consoleErrors).toEqual([])
  } finally {
    await close()
  }
})
