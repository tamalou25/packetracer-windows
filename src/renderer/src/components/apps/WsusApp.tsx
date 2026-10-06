/**
 * Console Services WSUS : post-installation, mises à jour (approbations par groupe, refus),
 * groupes d'ordinateurs, synchronisations et options (classifications, ciblage).
 */
import { useState } from 'react'
import { Download, Folder, FolderTree, Monitor, RefreshCw, Server, Settings } from 'lucide-react'
import {
  ALL_COMPUTERS,
  CLASSIFICATION_LABELS,
  UNASSIGNED_COMPUTERS,
  WSUS_CLASSIFICATIONS,
  approvedGroups,
  catalogUpdate,
  command,
  formatLongDate,
  wsusComputers,
  wsusGroups,
  wsusServerOf,
  type CatalogUpdate,
  type ServerDevice,
  type WsusClassification
} from '@engine/index'
import { runCommand, runCommandOk } from '../../lib/run'
import { useLabStore } from '../../store/lab'
import { Button, inputClass } from '../common/ui'
import { FormDialog } from '../common/FormDialog'
import { Mmc, MmcAction, MmcTable, type MmcNode } from '../mmc/Mmc'

const UPDATE_VIEWS: Record<string, { label: string; filter: (u: CatalogUpdate) => boolean }> = {
  'updates:all': { label: 'Toutes les mises à jour', filter: () => true },
  'updates:critical': { label: 'Mises à jour critiques', filter: (u) => u.classification === 'critical' },
  'updates:security': { label: 'Mises à jour de la sécurité', filter: (u) => u.classification === 'security' }
}

export function WsusApp({ device }: { device: ServerDevice }) {
  const wsus = wsusServerOf(device)
  const lab = useLabStore((s) => s.lab)
  const [selected, setSelected] = useState('server')
  const [newGroup, setNewGroup] = useState(false)
  if (!wsus || !device.host.features.includes('UpdateServices'))
    return <div className="p-6 text-sm text-slate-500">Le rôle Services WSUS n’est pas installé.</div>
  if (!wsus.configured) return <PostInstall device={device} />

  const groups = wsusGroups(wsus)
  const computers = wsusComputers(lab, device.id)
  const groupNode = (g: string): MmcNode => ({
    id: `group:${g}`,
    label: g,
    icon: Folder,
    iconClass: 'text-amber-600'
  })
  const nodes: MmcNode[] = [
    {
      id: 'server',
      label: device.name,
      icon: Server,
      iconClass: 'text-emerald-600',
      children: [
        {
          id: 'updates',
          label: 'Mises à jour',
          icon: Download,
          children: Object.entries(UPDATE_VIEWS).map(([id, v]) => ({ id, label: v.label, icon: Download }))
        },
        {
          id: 'computers',
          label: 'Ordinateurs',
          icon: FolderTree,
          children: [
            {
              ...groupNode(ALL_COMPUTERS),
              children: groups.filter((g) => g !== ALL_COMPUTERS).map(groupNode)
            }
          ]
        },
        { id: 'syncs', label: 'Synchronisations', icon: RefreshCw },
        { id: 'options', label: 'Options', icon: Settings }
      ]
    }
  ]

  const group = selected.startsWith('group:') ? selected.slice(6) : null
  const updateView = UPDATE_VIEWS[selected]
  const custom = group !== null && group !== ALL_COMPUTERS && group !== UNASSIGNED_COMPUTERS

  const actions = (
    <>
      <MmcAction onClick={() => runCommand(command('wsus.synchronize', device.id))} testId="wsus-sync">
        Synchroniser maintenant
      </MmcAction>
      {group === ALL_COMPUTERS && (
        <MmcAction onClick={() => setNewGroup(true)} testId="wsus-new-group">
          Ajouter un groupe d’ordinateurs…
        </MmcAction>
      )}
      {custom && (
        <MmcAction
          danger
          onClick={() => {
            if (runCommandOk(command('wsus.removeGroup', device.id, group)))
              setSelected(`group:${ALL_COMPUTERS}`)
          }}
        >
          Supprimer le groupe
        </MmcAction>
      )}
    </>
  )

  let content
  if (updateView) {
    content = <UpdatesView device={device} filter={updateView.filter} />
  } else if (group) {
    const members = group === ALL_COMPUTERS ? computers : computers.filter((c) => c.group === group)
    content = (
      <MmcTable
        testId="wsus-computers"
        columns={['Nom', 'Adresse IP', 'Système', 'Groupe']}
        empty="Aucun ordinateur dans ce groupe."
        rows={members.map((c) => [
          c.name,
          <span key="ip" className="font-mono">
            {c.ip}
          </span>,
          c.kind === 'server' ? 'Système serveur' : 'Système client',
          wsus.targeting === 'server' ? (
            <select
              key="group"
              className={`${inputClass} !h-6 !py-0 text-xs`}
              value={c.group}
              onChange={(e) =>
                runCommand(command('wsus.assignComputer', device.id, c.deviceId, e.target.value))
              }
              data-testid={`wsus-member-${c.name}`}
            >
              {groups
                .filter((g) => g !== ALL_COMPUTERS)
                .map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
            </select>
          ) : (
            c.group
          )
        ])}
      />
    )
  } else if (selected === 'syncs') {
    content = (
      <div className="flex flex-col gap-2 p-4 text-sm">
        <p>
          Dernière synchronisation :{' '}
          <b>{wsus.lastSync === null ? 'jamais' : formatLongDate(wsus.lastSync)}</b>
        </p>
        <p>{wsus.updates.length} mise(s) à jour sur le serveur.</p>
        <div>
          <Button variant="primary" onClick={() => runCommand(command('wsus.synchronize', device.id))}>
            Synchroniser maintenant
          </Button>
        </div>
      </div>
    )
  } else if (selected === 'options') {
    content = <OptionsView device={device} />
  } else {
    content = (
      <div className="p-4 text-sm text-slate-600">
        <p>
          Serveur WSUS <b>{device.name}</b> (port 8530) — contenu dans{' '}
          <span className="font-mono">{wsus.contentDir}</span>.
        </p>
        <p className="mt-2">
          {wsus.updates.length} mise(s) à jour, {computers.length} ordinateur(s),{' '}
          {wsus.targeting === 'server' ? 'ciblage côté serveur' : 'ciblage côté client'}.
        </p>
        {wsus.lastSync === null && (
          <p className="mt-2 text-xs text-amber-700">
            Le serveur n’a jamais été synchronisé : choisissez les classifications (Options) puis
            synchronisez.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="relative h-full">
      <Mmc nodes={nodes} selected={selected} onSelect={setSelected} actions={actions} testId="wsus-console">
        {content}
      </Mmc>
      {newGroup && (
        <FormDialog
          title="Ajouter un groupe d’ordinateurs"
          fields={[{ key: 'name', label: 'Nom' }]}
          onSubmit={(v) => {
            const name = runCommand(command('wsus.addGroup', device.id, String(v['name'])))
            if (name) setSelected(`group:${name}`)
            return name !== undefined
          }}
          onClose={() => setNewGroup(false)}
          submitLabel="Ajouter"
          testId="wsus-group-dialog"
        />
      )}
    </div>
  )
}

function UpdatesView({ device, filter }: { device: ServerDevice; filter: (u: CatalogUpdate) => boolean }) {
  const wsus = wsusServerOf(device)!
  const groups = wsusGroups(wsus)
  const [target, setTarget] = useState(groups[0] ?? ALL_COMPUTERS)
  const updates = wsus.updates.flatMap((id) => {
    const u = catalogUpdate(id)
    return u && filter(u) ? [u] : []
  })
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-xs">
        Approuver pour le groupe :
        <select
          className={`${inputClass} !h-6 w-56 !py-0 text-xs`}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          data-testid="wsus-approve-group"
        >
          {groups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>
      <MmcTable
        testId="wsus-updates"
        columns={['Titre', 'Classification', 'Approbation', '']}
        empty="Aucune mise à jour : synchronisez le serveur."
        rows={updates.map((u) => {
          const approved = approvedGroups(wsus, u.id)
          const declined = wsus.declined.includes(u.id)
          return [
            u.title,
            CLASSIFICATION_LABELS[u.classification],
            declined
              ? 'Refusée'
              : approved.length > 0
                ? `Installer (${approved.join(', ')})`
                : 'Non approuvée',
            <span key="actions" className="flex gap-2 whitespace-nowrap">
              <button
                type="button"
                className="text-sky-700 hover:underline"
                onClick={() =>
                  runCommand(command('wsus.approve', device.id, u.id, target, !approved.includes(target)))
                }
                data-testid={`wsus-approve-${u.id}`}
              >
                {approved.includes(target) ? 'Retirer l’approbation' : 'Approuver'}
              </button>
              <button
                type="button"
                className="text-red-600 hover:underline"
                onClick={() => runCommand(command('wsus.decline', device.id, u.id, !declined))}
              >
                {declined ? 'Annuler le refus' : 'Refuser'}
              </button>
            </span>
          ]
        })}
      />
    </div>
  )
}

function OptionsView({ device }: { device: ServerDevice }) {
  const wsus = wsusServerOf(device)!
  const toggle = (c: WsusClassification, enabled: boolean) =>
    runCommand(command('wsus.setClassification', device.id, c, enabled))
  return (
    <div className="grid grid-cols-2 gap-6 p-4 text-xs">
      <section>
        <h3 className="mb-2 font-semibold">Produits et classifications</h3>
        <p className="mb-2 text-slate-500">Classifications des mises à jour à synchroniser :</p>
        {WSUS_CLASSIFICATIONS.map((c) => (
          <label key={c} className="flex items-center gap-1.5 py-0.5">
            <input
              type="checkbox"
              checked={wsus.classifications.includes(c)}
              onChange={(e) => toggle(c, e.target.checked)}
              data-testid={`wsus-class-${c}`}
            />
            {CLASSIFICATION_LABELS[c]}
          </label>
        ))}
      </section>
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 font-semibold">
          <Monitor size={13} /> Ordinateurs
        </h3>
        <p className="mb-2 text-slate-500">Affectation des ordinateurs aux groupes :</p>
        {(
          [
            ['server', 'Utiliser la console Update Services'],
            ['client', 'Utiliser les paramètres de stratégie de groupe ou du Registre sur les ordinateurs']
          ] as const
        ).map(([mode, label]) => (
          <label key={mode} className="flex items-start gap-1.5 py-0.5">
            <input
              type="radio"
              checked={wsus.targeting === mode}
              onChange={() => runCommand(command('wsus.setTargeting', device.id, mode))}
              data-testid={`wsus-targeting-${mode}`}
            />
            {label}
          </label>
        ))}
      </section>
    </div>
  )
}

function PostInstall({ device }: { device: ServerDevice }) {
  const [dir, setDir] = useState('C:\\WSUS')
  return (
    <div className="flex max-w-lg flex-col gap-3 p-6 text-sm" data-testid="wsus-postinstall">
      <h2 className="font-semibold">Terminer l’installation de WSUS</h2>
      <p className="text-xs text-slate-600">
        Les tâches de post-installation n’ont pas été exécutées. Indiquez le dossier local où stocker les
        mises à jour, puis lancez la configuration.
      </p>
      <input
        className={inputClass}
        value={dir}
        onChange={(e) => setDir(e.target.value)}
        data-testid="wsus-content-dir"
      />
      <div>
        <Button
          variant="primary"
          onClick={() =>
            runCommand(command('wsus.postInstall', device.id, dir), {
              success: 'Configuration post-installation de WSUS terminée.'
            })
          }
        >
          Exécuter
        </Button>
      </div>
    </div>
  )
}
