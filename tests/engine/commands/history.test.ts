/**
 * Historique annuler / rétablir : limite, pile de rétablissement, aller-retour sur des commandes
 * réelles, tâches de fond conservées, entrée devenue inapplicable, libellés du menu Édition.
 */
import { describe, expect, it } from 'vitest'
import {
  command,
  createLab,
  dispatch,
  emptyHistory,
  HISTORY_LIMIT,
  historyLabels,
  menuLabel,
  truncateMenuLabel,
  recordEntry,
  redoStep,
  runBackgroundTasks,
  undoStep,
  type AnyCommand,
  type History,
  type JournalEntry,
  type LabState
} from '@engine/index'

const id = (s: LabState, name: string) => Object.values(s.devices).find((d) => d.name === name)?.id ?? ''
const iface = (s: LabState, name: string, index = 0) => s.devices[id(s, name)]?.interfaces[index]?.id ?? ''

/** Entrée factice (seul le libellé compte pour la limite et les libellés). */
const fake = (label: string): JournalEntry => ({
  type: 'test',
  args: [],
  label,
  time: 0,
  patches: [],
  inversePatches: []
})

/** Exécute des commandes et les enregistre dans l'historique, comme le store de l'interface. */
function run(start: { state: LabState; history: History }, ...commands: AnyCommand[]) {
  let { state, history } = start
  for (const cmd of commands) {
    const r = dispatch(state, cmd)
    if (!r.ok) throw new Error(`${cmd.type} : ${r.error.message}`)
    state = r.state
    if (r.entry) history = recordEntry(history, r.entry)
  }
  return { state, history }
}

const add = (kind: 'server' | 'client' | 'switch', name: string, x = 0) =>
  command('topology.addDevice', { kind, position: { x, y: 0 }, name })

describe('historique annuler / rétablir', () => {
  it(`conserve les ${HISTORY_LIMIT} dernières commandes, les plus anciennes sont oubliées`, () => {
    let h = emptyHistory()
    for (let i = 1; i <= HISTORY_LIMIT + 5; i++) h = recordEntry(h, fake(`E${i}`))
    expect(h.past).toHaveLength(HISTORY_LIMIT)
    expect(h.past[0]?.label).toBe('E6')
    expect(historyLabels(h).undo).toBe(`E${HISTORY_LIMIT + 5}`)
  })

  it('une nouvelle commande vide la pile de rétablissement', () => {
    let s = run({ state: createLab(), history: emptyHistory() }, add('server', 'SRV1'), add('client', 'PC1'))
    const undone = undoStep(s.state, s.history)
    if (!undone.ok) throw new Error(undone.error.message)
    expect(historyLabels(undone.history)).toEqual({ undo: 'Ajouter SRV1', redo: 'Ajouter PC1' })
    s = run({ state: undone.state, history: undone.history }, add('switch', 'SW1'))
    expect(s.history.future).toEqual([])
    expect(redoStep(s.state, s.history)).toMatchObject({ ok: false, error: { code: 'NothingToRedo' } })
  })

  it('tout annuler ramène l’état initial, tout rétablir l’état final', () => {
    const initial = createLab()
    let s = run({ state: initial, history: emptyHistory() }, add('server', 'SRV1'), add('switch', 'SW1', 200))
    s = run(
      s,
      command(
        'topology.connect',
        { deviceId: id(s.state, 'SRV1'), ifaceId: iface(s.state, 'SRV1') },
        { deviceId: id(s.state, 'SW1'), ifaceId: iface(s.state, 'SW1') }
      ),
      command('topology.renameDevice', id(s.state, 'SRV1'), 'DC1'),
      command('system.installFeatures', id(s.state, 'SRV1'), ['DNS'])
    )
    const final = s.state
    let { state, history } = s
    for (let step = undoStep(state, history); step.ok; step = undoStep(state, history)) {
      state = step.state
      history = step.history
    }
    expect(state).toEqual(initial)
    expect(history.future).toHaveLength(5)
    for (let step = redoStep(state, history); step.ok; step = redoStep(state, history)) {
      state = step.state
      history = step.history
    }
    expect(state).toEqual(final)
    expect(history.past).toHaveLength(5)
  })

  it('annuler une action ne défait pas un bail DHCP obtenu en tâche de fond', () => {
    let s = run(
      { state: createLab(), history: emptyHistory() },
      add('server', 'SRV1'),
      add('client', 'PC1', 400),
      add('switch', 'SW1', 200)
    )
    for (const [name, port] of [
      ['SRV1', 0],
      ['PC1', 1]
    ] as const)
      s = run(
        s,
        command(
          'topology.connect',
          { deviceId: id(s.state, name), ifaceId: iface(s.state, name) },
          { deviceId: id(s.state, 'SW1'), ifaceId: iface(s.state, 'SW1', port) }
        )
      )
    const srv = id(s.state, 'SRV1')
    s = run(
      s,
      command('net.setInterfaceIpv4', srv, iface(s.state, 'SRV1'), {
        addressing: 'static',
        address: '192.168.1.1',
        mask: '24',
        gateway: null,
        dnsServers: []
      }),
      command('system.installFeatures', srv, ['DHCP']),
      command('dhcp.addScope', srv, {
        name: 'LAN',
        start: '192.168.1.100',
        end: '192.168.1.150',
        mask: '255.255.255.0'
      }),
      command('topology.renameDevice', srv, 'DC1')
    )
    // Tâche de fond hors historique : le poste obtient un bail
    const settled = runBackgroundTasks(s.state).state
    const lease = (state: LabState) => state.devices[id(state, 'PC1')]?.interfaces[0]?.dhcpLease?.address
    expect(lease(settled)).toBe('192.168.1.100')
    const undone = undoStep(settled, s.history)
    if (!undone.ok) throw new Error(undone.error.message)
    expect(undone.entry.label).toBe('Renommer SRV1 en DC1')
    expect(undone.state.devices[srv]?.name).toBe('SRV1')
    expect(lease(undone.state)).toBe('192.168.1.100')
  })

  it('une entrée devenue inapplicable est écartée avec un message', () => {
    let s = run({ state: createLab(), history: emptyHistory() }, add('server', 'SRV1'))
    const srv = id(s.state, 'SRV1')
    s = run(s, command('topology.renameDevice', srv, 'DC1'))
    // Modification extérieure à l'historique : l'équipement a disparu
    const removed = dispatch(s.state, command('topology.removeDevices', [srv]))
    if (!removed.ok) throw new Error(removed.error.message)
    const step = undoStep(removed.state, s.history)
    expect(step.ok).toBe(false)
    if (step.ok) return
    expect(step.error.code).toBe('UndoNotApplicable')
    expect(step.error.message).toBe('Impossible d’annuler « Renommer SRV1 en DC1 » : le lab a changé depuis.')
    expect(historyLabels(step.history)).toEqual({ undo: 'Ajouter SRV1', redo: null })
  })

  it('rien à annuler ni à rétablir sur un historique vide', () => {
    const state = createLab()
    expect(undoStep(state, emptyHistory())).toMatchObject({
      ok: false,
      error: { message: 'Rien à annuler.' }
    })
    expect(redoStep(state, emptyHistory())).toMatchObject({
      ok: false,
      error: { message: 'Rien à rétablir.' }
    })
    expect(historyLabels(emptyHistory())).toEqual({ undo: null, redo: null })
  })

  it('équipement posé depuis la palette : le libellé donne le nom qu’il recevra', () => {
    const s = run(
      { state: createLab(), history: emptyHistory() },
      command('topology.addDevice', { kind: 'server', position: { x: 0, y: 0 } }),
      command('topology.addDevice', { kind: 'server', position: { x: 0, y: 0 } })
    )
    expect(s.history.past.map((e) => e.label)).toEqual(['Ajouter SRV1', 'Ajouter SRV2'])
  })

  it('libellés du menu Édition, tronqués au besoin', () => {
    expect(menuLabel('Annuler', null)).toBe('Annuler')
    expect(menuLabel('Annuler', 'Ajouter SRV1')).toBe('Annuler : Ajouter SRV1')
    const long = menuLabel('Rétablir', `New-NetIPAddress ${'x'.repeat(100)}`, 30)
    expect(long.startsWith('Rétablir : New-NetIPAddress')).toBe(true)
    expect(long.endsWith('…')).toBe(true)
    expect(long.length).toBe('Rétablir : '.length + 30)
    // Troncature seule (libellé composé par l'interface dans sa langue)
    expect(truncateMenuLabel('Ajouter SRV1')).toBe('Ajouter SRV1')
    expect(truncateMenuLabel('x'.repeat(100), 10)).toBe(`${'x'.repeat(9)}…`)
  })
})
