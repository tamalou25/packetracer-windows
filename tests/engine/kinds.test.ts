import { describe, expect, it } from 'vitest'
import { DEVICE_KIND_INFO, DEVICE_KINDS } from '@engine/index'

describe('catalogue des équipements', () => {
  it('décrit chaque type d’équipement', () => {
    for (const kind of DEVICE_KINDS) {
      expect(DEVICE_KIND_INFO[kind].label.length).toBeGreaterThan(0)
      expect(DEVICE_KIND_INFO[kind].namePrefix).toMatch(/^[A-Z]+$/)
    }
  })
})
