/**
 * Console Services Bureau à distance (Gestionnaire de serveur) : collections de sessions, groupes
 * d'utilisateurs, programmes RemoteApp et sessions ouvertes.
 */
import { useState } from 'react'
import { AppWindow, Layers, MonitorSmartphone, Server, Users } from 'lucide-react'
import { command, rdsServerOf, type ServerDevice } from '@engine/index'
import { runCommand, runCommandOk } from '../../lib/run'
import { Button, inputClass } from '../common/ui'
import { FormDialog } from '../common/FormDialog'
import { Mmc, MmcAction, MmcTable, type MmcNode } from '../mmc/Mmc'

const groupsOf = (text: string) =>
  text
    .split(/[,;]/)
    .map((g) => g.trim())
    .filter((g) => g)

export function RdsApp({ device }: { device: ServerDevice }) {
  const rds = rdsServerOf(device)
  const [selected, setSelected] = useState('server')
  const [dialog, setDialog] = useState<'collection' | 'app' | null>(null)
  if (!rds || !device.host.features.includes('RDS-RD-Server'))
    return (
      <div className="p-6 text-sm text-slate-500">
        Le rôle Hôte de session Bureau à distance n’est pas installé.
      </div>
    )

  const nodes: MmcNode[] = [
    {
      id: 'server',
      label: `Déploiement ${device.name}`,
      icon: Server,
      iconClass: 'text-emerald-600',
      children: [
        {
          id: 'collections',
          label: 'Collections',
          icon: Layers,
          children: rds.collections.map((c) => ({ id: `col:${c.name}`, label: c.name, icon: Users }))
        },
        { id: 'sessions', label: 'Sessions', icon: MonitorSmartphone }
      ]
    }
  ]
  const collection = selected.startsWith('col:')
    ? rds.collections.find((c) => c.name === selected.slice(4))
    : undefined

  const actions = (
    <>
      <MmcAction onClick={() => setDialog('collection')} testId="rds-new-collection">
        Créer une collection de sessions…
      </MmcAction>
      {collection && (
        <>
          <MmcAction onClick={() => setDialog('app')} testId="rds-new-app">
            Publier des programmes RemoteApp…
          </MmcAction>
          <MmcAction
            danger
            onClick={() => {
              if (runCommandOk(command('rds.removeCollection', device.id, collection.name)))
                setSelected('collections')
            }}
          >
            Supprimer la collection
          </MmcAction>
        </>
      )}
    </>
  )

  let content
  if (collection) content = <CollectionView device={device} name={collection.name} />
  else if (selected === 'sessions')
    content = (
      <MmcTable
        testId="rds-sessions"
        columns={['Utilisateur', 'Client', 'Programme', '']}
        empty="Aucune session ouverte."
        rows={device.host.remoteSessions.map((s) => [
          s.account,
          s.from,
          s.app ?? 'Bureau',
          <button
            key="off"
            type="button"
            className="text-red-600 hover:underline"
            onClick={() => runCommand(command('rds.disconnect', device.id, s.id))}
          >
            Fermer la session
          </button>
        ])}
      />
    )
  else
    content = (
      <MmcTable
        testId="rds-collections"
        columns={['Collection', 'Type de ressource', 'Groupes d’utilisateurs']}
        empty="Aucune collection : créez-en une pour autoriser l’accès à cet hôte de session."
        rows={rds.collections.map((c) => [
          c.name,
          c.remoteApps.length > 0 ? 'Programmes RemoteApp' : 'Bureau à distance',
          c.userGroups.join(', ')
        ])}
      />
    )

  return (
    <div className="relative h-full">
      <Mmc nodes={nodes} selected={selected} onSelect={setSelected} actions={actions} testId="rds-console">
        {content}
      </Mmc>
      {dialog === 'collection' && (
        <FormDialog
          title="Créer une collection de sessions"
          fields={[
            { key: 'name', label: 'Nom de la collection' },
            {
              key: 'groups',
              label: 'Groupes d’utilisateurs (séparés par des virgules)',
              initial: 'LAB\\Utilisateurs du domaine'
            }
          ]}
          onSubmit={(v) => {
            const ok = runCommandOk(
              command('rds.addCollection', device.id, {
                name: String(v['name']),
                userGroups: groupsOf(String(v['groups']))
              })
            )
            if (ok) setSelected(`col:${String(v['name']).trim()}`)
            return ok
          }}
          onClose={() => setDialog(null)}
          testId="rds-collection-dialog"
        />
      )}
      {dialog === 'app' && collection && (
        <FormDialog
          title="Publier des programmes RemoteApp"
          fields={[
            { key: 'name', label: 'Nom du programme', placeholder: 'Bloc-notes' },
            { key: 'path', label: 'Chemin d’accès', placeholder: 'C:\\Windows\\System32\\notepad.exe' }
          ]}
          onSubmit={(v) =>
            runCommand(
              command('rds.addRemoteApp', device.id, collection.name, {
                displayName: String(v['name']),
                filePath: String(v['path'])
              })
            ) !== undefined
          }
          onClose={() => setDialog(null)}
          testId="rds-app-dialog"
        />
      )}
    </div>
  )
}

function CollectionView({ device, name }: { device: ServerDevice; name: string }) {
  const collection = rdsServerOf(device)?.collections.find((c) => c.name === name)
  const [groups, setGroups] = useState(collection?.userGroups.join(', ') ?? '')
  if (!collection) return null
  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      <div className="flex items-center gap-2">
        Groupes d’utilisateurs :
        <input
          className={`${inputClass} w-80`}
          value={groups}
          onChange={(e) => setGroups(e.target.value)}
          data-testid="rds-groups"
        />
        <Button
          onClick={() =>
            runCommand(command('rds.setCollectionUserGroups', device.id, name, groupsOf(groups)))
          }
        >
          Appliquer
        </Button>
      </div>
      <MmcTable
        testId="rds-apps"
        columns={['Programme RemoteApp', 'Alias', 'Chemin d’accès', '']}
        empty="Aucun programme RemoteApp : la collection publie le bureau complet."
        rows={collection.remoteApps.map((a) => [
          <span key="n" className="flex items-center gap-1">
            <AppWindow size={12} /> {a.displayName}
          </span>,
          a.alias,
          a.filePath,
          <button
            key="del"
            type="button"
            className="text-red-600 hover:underline"
            onClick={() => runCommand(command('rds.removeRemoteApp', device.id, name, a.alias))}
          >
            Retirer
          </button>
        ])}
      />
    </div>
  )
}
