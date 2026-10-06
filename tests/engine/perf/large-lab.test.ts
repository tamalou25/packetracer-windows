/**
 * Générateur de la topologie de 100 équipements utilisée pour les mesures de performance.
 */
import { describe, expect, it } from 'vitest'
import { buildLargeLab } from '../../support/large-lab'

describe('générateur de grande topologie', () => {
  it('100 équipements câblés, baux DHCP obtenus sauf sur le switch isolé', () => {
    const { state, ids } = buildLargeLab()
    expect(Object.keys(state.devices)).toHaveLength(100)
    expect(Object.keys(state.links)).toHaveLength(3 + 6 + 89)
    const lease = (name: string) => state.devices[ids[name] ?? '']?.interfaces[0]?.dhcpLease?.address
    expect(lease('PC1')).toMatch(/^10\.0\./)
    // PC85 à PC89 : switch SW8 non raccordé au cœur
    expect(lease('PC85')).toBeUndefined()
    // Un poste sur huit en statique
    expect(state.devices[ids['PC8'] ?? '']?.interfaces[0]?.addressing).toBe('static')
  })
})
