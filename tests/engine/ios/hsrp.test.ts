/**
 * HSRP : élection, passerelle virtuelle, bascule à la coupure de l'interface ou de l'équipement
 * actif, retour avec preempt (et maintien sans preempt).
 */
import { describe, expect, it } from 'vitest'
import { ping, runBackgroundTasks, setPower, unwrap, type LabState } from '@engine/index'
import { add, cable, createLab, setIp } from '../helpers'
import { addIos, IosConsole, type SharedLab } from './helpers'

const reaches = (state: LabState, from: string, to: string): boolean => {
  const r = ping(state, from, to)
  return r.ok && r.value.success
}

/** R1 et R2 (1921) Gi0/0 sur SW1 (2960) ; PC1 sur SW1, passerelle virtuelle 192.168.1.254. */
function hsrpLab(options: { preempt?: boolean } = {}) {
  const r1 = addIos(createLab(), 'c1921')
  const r2 = addIos(r1.state, 'c1921')
  const sw = addIos(r2.state, 'c2960')
  const pc = add(sw.state, 'client')
  let s = cable(pc.state, r1.id, 0, sw.id, 0)
  s = cable(s, r2.id, 0, sw.id, 1)
  s = cable(s, pc.id, 0, sw.id, 2)
  s = setIp(s, pc.id, 0, '192.168.1.10/24', '192.168.1.254')
  const lab: SharedLab = { state: s }
  const c1 = new IosConsole(lab, r1.id)
  const c2 = new IosConsole(lab, r2.id)
  c1.lines('en', 'conf t', 'int g0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shut')
  c2.lines('en', 'conf t', 'int g0/0', 'ip address 192.168.1.2 255.255.255.0', 'no shut')
  c2.run('standby 1 ip 192.168.1.254')
  const out = c1.lines(
    'standby 1 ip 192.168.1.254',
    'standby 1 priority 110',
    ...(options.preempt === false ? [] : ['standby 1 preempt'])
  )
  return { lab, c1, c2, r1: r1.id, pc: pc.id, out }
}

const brief = (c: IosConsole) => c.run('do show standby brief').slice(3)

describe('HSRP', () => {
  it('élection : R1 (priorité 110, preempt) actif, R2 en attente', () => {
    const { lab, c1, c2, pc, out } = hsrpLab()
    // R2 était actif seul ; R1 le préempte à « standby 1 preempt »
    expect(out).toEqual(['%HSRP-6-STATECHANGE: GigabitEthernet0/0 Grp 1 state Standby -> Active'])
    expect(brief(c1)).toEqual([
      'Gi0/0       1    110 P Active  local           192.168.1.2     192.168.1.254'
    ])
    expect(brief(c2)).toEqual([
      'Gi0/0       1    100   Standby 192.168.1.1     local           192.168.1.254'
    ])
    expect(reaches(lab.state, pc, '192.168.1.254')).toBe(true)
    const run = c1.run('do show running-config')
    expect(run).toEqual(
      expect.arrayContaining([' standby 1 ip 192.168.1.254', ' standby 1 priority 110', ' standby 1 preempt'])
    )
  })

  it('bascule vers R2 quand l’interface active est coupée, retour avec preempt', () => {
    const { lab, c1, c2, pc } = hsrpLab()
    c1.run('shutdown')
    expect(brief(c2)[0]).toContain('Active  local')
    expect(reaches(lab.state, pc, '192.168.1.254')).toBe(true)
    // R1 revient : il reprend le rôle actif (preempt, priorité supérieure)
    c1.run('no shutdown')
    expect(brief(c1)[0]).toContain('Active  local')
    expect(brief(c2)[0]).toContain('Standby 192.168.1.1')
  })

  it('sans preempt, R2 garde le rôle actif au retour de R1', () => {
    const { c1, c2 } = hsrpLab({ preempt: false })
    c1.run('shutdown')
    c1.run('no shutdown')
    expect(brief(c2)[0]).toContain('Active  local')
    expect(brief(c1)[0]).toContain('Standby 192.168.1.2     local')
  })

  it('équipement actif éteint : bascule par la tâche de fond', () => {
    const { lab, c2, r1, pc } = hsrpLab()
    lab.state = unwrap(setPower(lab.state, r1, false)).state
    lab.state = runBackgroundTasks(lab.state).state
    expect(brief(c2)[0]).toContain('Active  local')
    expect(reaches(lab.state, pc, '192.168.1.254')).toBe(true)
  })
})
