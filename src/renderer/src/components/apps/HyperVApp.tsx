/**
 * Gestionnaire Hyper-V : machines virtuelles (création, démarrage, arrêt, connexion, suppression,
 * commutateur de la carte réseau) et Gestionnaire de commutateur virtuel.
 */
import { useState } from 'react'
import { Monitor, Network, Server } from 'lucide-react'
import {
  VSWITCH_TYPE_LABELS,
  command,
  hyperVOf,
  switchOfAdapter,
  type ServerDevice,
  type VSwitchType
} from '@engine/index'
import { runCommand, runCommandOk } from '../../lib/run'
import { useLabStore } from '../../store/lab'
import { useUiStore } from '../../store/ui'
import { inputClass } from '../common/ui'
import { FormDialog, type FormValues } from '../common/FormDialog'
import { Mmc, MmcAction, MmcTable, type MmcNode } from '../mmc/Mmc'

export function HyperVApp({ device }: { device: ServerDevice }) {
  const hv = hyperVOf(device)
  const lab = useLabStore((s) => s.lab)
  const [selected, setSelected] = useState('host')
  const [dialog, setDialog] = useState<'vm' | 'switch' | null>(null)
  if (!hv || !device.host.features.includes('Hyper-V'))
    return <div className="p-6 text-sm text-slate-500">Le rôle Hyper-V n’est pas installé.</div>

  const nodes: MmcNode[] = [
    {
      id: 'manager',
      label: 'Gestionnaire Hyper-V',
      icon: Server,
      iconClass: 'text-sky-700',
      children: [
        { id: 'host', label: device.name, icon: Server, iconClass: 'text-emerald-600' },
        { id: 'switches', label: 'Gestionnaire de commutateur virtuel', icon: Network }
      ]
    }
  ]
  const vms = hv.vms.flatMap((vm) => {
    const d = lab.devices[vm.deviceId]
    return d ? [{ vm, device: d }] : []
  })
  const switchOptions = [
    { value: '', label: 'Non connecté' },
    ...hv.switches.map((s) => ({ value: s.name, label: s.name }))
  ]

  const submitVm = (v: FormValues): boolean =>
    runCommandOk(
      command('hyperv.newVm', device.id, {
        name: String(v['name']),
        guest: String(v['guest']) as 'server' | 'client',
        generation: Number(v['generation']) === 2 ? 2 : 1,
        memoryMB: Number(v['memory']) || 1024,
        switchName: String(v['switch']) || null
      })
    )

  const submitSwitch = (v: FormValues): boolean => {
    const type = String(v['type']) as VSwitchType
    return runCommandOk(
      command('hyperv.newSwitch', device.id, {
        name: String(v['name']),
        type,
        ...(type === 'External'
          ? { netAdapter: String(v['adapter']), allowManagementOS: v['management'] === true }
          : {})
      })
    )
  }

  const actions = (
    <>
      <MmcAction onClick={() => setDialog('vm')} testId="hv-new-vm">
        Nouveau › Ordinateur virtuel…
      </MmcAction>
      <MmcAction onClick={() => setDialog('switch')} testId="hv-new-switch">
        Nouveau commutateur réseau virtuel…
      </MmcAction>
    </>
  )

  const content =
    selected === 'switches' ? (
      <MmcTable
        testId="hv-switches"
        columns={['Commutateur virtuel', 'Type de connexion', 'Carte réseau', '']}
        empty="Aucun commutateur virtuel."
        rows={hv.switches.map((s) => [
          s.name,
          VSWITCH_TYPE_LABELS[s.type],
          device.interfaces.find((i) => i.id === s.netAdapter)?.name ?? '',
          <button
            key="del"
            type="button"
            className="text-red-600 hover:underline"
            onClick={() => runCommand(command('hyperv.removeSwitch', device.id, s.name))}
          >
            Supprimer
          </button>
        ])}
      />
    ) : (
      <MmcTable
        testId="hv-vms"
        columns={['Nom', 'État', 'Mémoire', 'Génération', 'Commutateur', '']}
        empty="Aucun ordinateur virtuel n’a été trouvé sur ce serveur."
        rows={vms.map(({ vm, device: d }) => {
          const nic = d.interfaces[0]
          const sw = nic ? switchOfAdapter(lab, hv, d.id, nic.id) : null
          return [
            <span key="n" className="flex items-center gap-1">
              <Monitor size={12} /> {d.name}
            </span>,
            d.powered ? 'Exécution' : 'Désactivé',
            `${vm.memoryMB} Mo`,
            String(vm.generation),
            <select
              key="sw"
              className={`${inputClass} !h-6 !py-0 text-xs`}
              value={sw?.name ?? ''}
              onChange={(e) =>
                runCommand(command('hyperv.connectAdapter', device.id, d.name, e.target.value || null))
              }
              data-testid={`hv-switch-${d.name}`}
            >
              {switchOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>,
            <span key="a" className="flex gap-2 whitespace-nowrap">
              <button
                type="button"
                className="text-sky-700 hover:underline"
                onClick={() => runCommand(command('hyperv.setVmState', device.id, d.name, !d.powered))}
                data-testid={`hv-power-${d.name}`}
              >
                {d.powered ? 'Arrêter' : 'Démarrer'}
              </button>
              <button
                type="button"
                className="text-sky-700 hover:underline"
                onClick={() => useUiStore.getState().openWindow(d.id, 'desktop')}
                data-testid={`hv-connect-${d.name}`}
              >
                Se connecter
              </button>
              <button
                type="button"
                className="text-red-600 hover:underline"
                onClick={() => runCommand(command('hyperv.removeVm', device.id, d.name))}
              >
                Supprimer
              </button>
            </span>
          ]
        })}
      />
    )

  return (
    <div className="relative h-full">
      <Mmc nodes={nodes} selected={selected} onSelect={setSelected} actions={actions} testId="hv-console">
        {content}
      </Mmc>
      {dialog === 'vm' && (
        <FormDialog
          title="Assistant Nouvel ordinateur virtuel"
          fields={[
            { key: 'name', label: 'Nom', placeholder: 'VM1' },
            {
              key: 'guest',
              label: 'Système invité',
              type: 'select',
              options: [
                { value: 'server', label: 'Système d’exploitation serveur' },
                { value: 'client', label: 'Système d’exploitation client' }
              ]
            },
            {
              key: 'generation',
              label: 'Génération',
              type: 'select',
              options: [
                { value: '1', label: 'Génération 1' },
                { value: '2', label: 'Génération 2' }
              ]
            },
            { key: 'memory', label: 'Mémoire de démarrage (Mo)', initial: '1024' },
            {
              key: 'switch',
              label: 'Connexion (commutateur virtuel)',
              type: 'select',
              options: switchOptions
            }
          ]}
          onSubmit={submitVm}
          onClose={() => setDialog(null)}
          submitLabel="Terminer"
          testId="hv-vm-dialog"
        />
      )}
      {dialog === 'switch' && (
        <FormDialog
          title="Nouveau commutateur réseau virtuel"
          fields={[
            { key: 'name', label: 'Nom' },
            {
              key: 'type',
              label: 'Type de connexion',
              type: 'select',
              options: (['External', 'Internal', 'Private'] as const).map((t) => ({
                value: t,
                label: `${VSWITCH_TYPE_LABELS[t]}`
              }))
            },
            {
              key: 'adapter',
              label: 'Réseau externe (carte physique)',
              type: 'select',
              options: device.interfaces
                .filter((i) => !i.name.startsWith('vEthernet') && !i.bridge)
                .map((i) => ({ value: i.name, label: i.name }))
            },
            {
              key: 'management',
              label: 'Autoriser le système d’exploitation de gestion à partager cette carte réseau',
              type: 'checkbox',
              initial: true
            }
          ]}
          onSubmit={submitSwitch}
          onClose={() => setDialog(null)}
          testId="hv-switch-dialog"
        />
      )}
    </div>
  )
}
