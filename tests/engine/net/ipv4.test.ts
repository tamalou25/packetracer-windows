import { describe, expect, it } from 'vitest'
import {
  apipaFromMac,
  formatIpv4,
  hostAddressError,
  maskToPrefix,
  networkAddress,
  parseIpv4,
  parseMaskOrPrefix,
  prefixToMask,
  sameSubnet
} from '@engine/index'

describe('IPv4', () => {
  it('analyse et formate les adresses', () => {
    expect(parseIpv4('192.168.1.10')).toBe(0xc0a8010a)
    expect(formatIpv4(0xc0a8010a)).toBe('192.168.1.10')
    expect(parseIpv4('256.1.1.1')).toBeNull()
    expect(parseIpv4('1.2.3')).toBeNull()
    expect(parseIpv4('a.b.c.d')).toBeNull()
  })

  it('convertit masques et préfixes', () => {
    expect(prefixToMask(24)).toBe('255.255.255.0')
    expect(prefixToMask(26)).toBe('255.255.255.192')
    expect(maskToPrefix('255.255.240.0')).toBe(20)
    expect(maskToPrefix('255.0.255.0')).toBeNull()
    expect(parseMaskOrPrefix('/16')).toBe(16)
    expect(parseMaskOrPrefix('255.255.255.252')).toBe(30)
  })

  it('calcule réseau et appartenance', () => {
    expect(networkAddress('10.1.2.3', 8)).toBe('10.0.0.0')
    expect(sameSubnet('192.168.1.10', '192.168.1.200', 24)).toBe(true)
    expect(sameSubnet('192.168.1.10', '192.168.2.10', 24)).toBe(false)
    expect(sameSubnet('192.168.1.10', '192.168.1.100', 26)).toBe(false)
  })

  it('refuse les adresses non attribuables', () => {
    expect(hostAddressError('192.168.1.0', 24)).toContain('adresse du réseau')
    expect(hostAddressError('192.168.1.255', 24)).toContain('diffusion')
    expect(hostAddressError('127.0.0.1', 8)).toContain('bouclage')
    expect(hostAddressError('192.168.1.10', 24)).toBeNull()
  })

  it('dérive une adresse APIPA de la MAC', () => {
    expect(apipaFromMac('02-53-4C-00-00-01')).toBe('169.254.1.2')
  })
})
