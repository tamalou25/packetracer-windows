/**
 * Critères de lab du rôle Hyper-V (l'isolement réseau se vérifie avec le critère `ping`).
 */
import { z } from 'zod'
import { serverByName } from '../../labs/lookup'
import { defineCriterion } from '../types'
import { VSWITCH_TYPES } from './schema'
import { switchOfAdapter } from './actions'
import { hyperVOf } from './state'

export const hypervCriteria = [
  defineCriterion(
    z.object({
      type: z.literal('vmSwitch'),
      host: z.string(),
      name: z.string(),
      switchType: z.enum(VSWITCH_TYPES).optional()
    }),
    (state, check) => {
      const sw = hyperVOf(serverByName(state, check.host))?.switches.find(
        (s) => s.name.toLowerCase() === check.name.toLowerCase()
      )
      return !!sw && (check.switchType === undefined || sw.type === check.switchType)
    },
    'Commutateur virtuel Hyper-V'
  ),
  defineCriterion(
    z.object({
      type: z.literal('virtualMachine'),
      host: z.string(),
      name: z.string(),
      running: z.boolean().optional(),
      /** Commutateur virtuel de la première carte réseau. */
      switch: z.string().optional()
    }),
    (state, check) => {
      const host = serverByName(state, check.host)
      const hv = hyperVOf(host)
      if (!host || !hv) return false
      const device = hv.vms
        .map((v) => state.devices[v.deviceId])
        .find((d) => d?.name.toLowerCase() === check.name.toLowerCase())
      if (!device) return false
      if (check.running !== undefined && device.powered !== check.running) return false
      const nic = device.interfaces[0]
      const sw = nic ? switchOfAdapter(state, hv, device.id, nic.id) : null
      return check.switch === undefined || sw?.name.toLowerCase() === check.switch.toLowerCase()
    },
    'Machine virtuelle Hyper-V'
  )
]
