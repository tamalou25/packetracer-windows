/**
 * Console Gestion du système de fichiers distribués DFS : espaces de noms (dossiers, cibles) et
 * réplication (groupes, membres, dossiers répliqués, réplication immédiate).
 */
import { useState } from 'react'
import { FolderTree, Network, RefreshCw, Share2 } from 'lucide-react'
import { command, dfsOf, type LabState, type ReplicationGroup, type ServerDevice } from '@engine/index'
import { runCommand, runCommandOk } from '../../lib/run'
import { useLabStore } from '../../store/lab'
import { FormDialog, type FormField, type FormValues } from '../common/FormDialog'
import { Mmc, MmcAction, MmcTable, type MmcNode } from '../mmc/Mmc'

type Dialog = 'namespace' | 'folder' | 'target' | 'group' | 'member' | 'rfolder' | 'membership' | null

/** Espaces de noms et groupes de réplication visibles du domaine (tous serveurs). */
function domainDfs(lab: LabState, domain: string | null) {
  const servers = Object.values(lab.devices).filter(
    (d): d is ServerDevice => d.kind === 'server' && !!domain && d.host.domain === domain
  )
  return {
    servers,
    namespaces: servers.flatMap((s) =>
      (dfsOf(s)?.namespaces ?? []).map((n) => ({ server: s, namespace: n }))
    ),
    groups: servers.flatMap((s) => dfsOf(s)?.groups ?? [])
  }
}

export function DfsApp({ device }: { device: ServerDevice }) {
  const lab = useLabStore((s) => s.lab)
  const [selected, setSelected] = useState('ns')
  const [dialog, setDialog] = useState<Dialog>(null)
  const domain = device.host.domain
  const { servers, namespaces, groups } = domainDfs(lab, domain)

  const nodes: MmcNode[] = [
    {
      id: 'root',
      label: 'Gestion du système DFS',
      icon: Share2,
      iconClass: 'text-sky-700',
      children: [
        {
          id: 'ns',
          label: 'Espaces de noms',
          icon: FolderTree,
          children: namespaces.map(({ namespace }) => ({
            id: `ns:${namespace.name}`,
            label: `\\\\${domain}\\${namespace.name}`,
            icon: FolderTree,
            children: namespace.folders.map((f) => ({
              id: `nsf:${namespace.name}:${f.name}`,
              label: f.name,
              icon: FolderTree
            }))
          }))
        },
        {
          id: 'rep',
          label: 'Réplication',
          icon: Network,
          children: groups.map((g) => ({ id: `rg:${g.name}`, label: g.name, icon: RefreshCw }))
        }
      ]
    }
  ]

  const nsName = selected.startsWith('ns:')
    ? selected.slice(3)
    : selected.startsWith('nsf:')
      ? selected.split(':')[1]
      : null
  const folderName = selected.startsWith('nsf:') ? selected.split(':')[2] : null
  const nsPath = nsName ? `\\\\${domain}\\${nsName}` : ''
  const group: ReplicationGroup | undefined = selected.startsWith('rg:')
    ? groups.find((g) => g.name === selected.slice(3))
    : undefined
  const serverOptions = servers.map((s) => ({ value: s.name, label: s.name }))

  const forms: Record<
    Exclude<Dialog, null>,
    { title: string; fields: FormField[]; submit: (v: FormValues) => boolean }
  > = {
    namespace: {
      title: 'Assistant Nouvel espace de noms',
      fields: [{ key: 'name', label: `Nom (\\\\${domain}\\…)`, placeholder: 'Partages' }],
      submit: (v) =>
        runCommand(command('dfs.newNamespace', device.id, { name: String(v['name']), createShare: true })) !==
        undefined
    },
    folder: {
      title: 'Nouveau dossier',
      fields: [
        { key: 'name', label: 'Nom', placeholder: 'Compta' },
        { key: 'target', label: 'Cible du dossier', placeholder: '\\\\SRV1\\Compta' }
      ],
      submit: (v) =>
        runCommandOk(command('dfs.newFolder', `${nsPath}\\${String(v['name'])}`, String(v['target'])))
    },
    target: {
      title: 'Nouvelle cible de dossier',
      fields: [
        { key: 'target', label: 'Chemin d’accès à la cible du dossier', placeholder: '\\\\SRV2\\Compta' }
      ],
      submit: (v) => runCommandOk(command('dfs.addTarget', `${nsPath}\\${folderName}`, String(v['target'])))
    },
    group: {
      title: 'Nouveau groupe de réplication',
      fields: [{ key: 'name', label: 'Nom du groupe de réplication' }],
      submit: (v) => runCommandOk(command('dfs.newGroup', device.id, String(v['name'])))
    },
    member: {
      title: 'Nouveau membre',
      fields: [{ key: 'computer', label: 'Serveur', type: 'select', options: serverOptions }],
      submit: (v) => runCommandOk(command('dfs.addMember', group?.name ?? '', String(v['computer'])))
    },
    rfolder: {
      title: 'Nouveau dossier répliqué',
      fields: [{ key: 'name', label: 'Nom du dossier répliqué' }],
      submit: (v) => runCommandOk(command('dfs.newReplicatedFolder', group?.name ?? '', String(v['name'])))
    },
    membership: {
      title: 'Chemin local d’un membre',
      fields: [
        {
          key: 'folder',
          label: 'Dossier répliqué',
          type: 'select',
          options: (group?.folders ?? []).map((f) => ({ value: f.name, label: f.name }))
        },
        {
          key: 'computer',
          label: 'Membre',
          type: 'select',
          options: (group?.members ?? []).map((id) => ({
            value: lab.devices[id]?.name ?? id,
            label: lab.devices[id]?.name ?? id
          }))
        },
        { key: 'path', label: 'Chemin d’accès local', placeholder: 'C:\\Compta' },
        {
          key: 'primary',
          label: 'Membre principal (fait autorité lors de la réplication initiale)',
          type: 'checkbox'
        }
      ],
      submit: (v) =>
        runCommandOk(
          command('dfs.setMembership', group?.name ?? '', String(v['folder']), String(v['computer']), {
            contentPath: String(v['path']),
            primary: v['primary'] === true
          })
        )
    }
  }

  const actions = (
    <>
      <MmcAction onClick={() => setDialog('namespace')} testId="dfs-new-ns">
        Nouvel espace de noms…
      </MmcAction>
      {nsName && !folderName && (
        <MmcAction onClick={() => setDialog('folder')} testId="dfs-new-folder">
          Nouveau dossier…
        </MmcAction>
      )}
      {folderName && (
        <MmcAction onClick={() => setDialog('target')} testId="dfs-new-target">
          Ajouter une cible de dossier…
        </MmcAction>
      )}
      <MmcAction onClick={() => setDialog('group')} testId="dfs-new-group">
        Nouveau groupe de réplication…
      </MmcAction>
      {group && (
        <>
          <MmcAction onClick={() => setDialog('member')} testId="dfs-new-member">
            Nouveau membre…
          </MmcAction>
          <MmcAction onClick={() => setDialog('rfolder')} testId="dfs-new-rfolder">
            Nouveau dossier répliqué…
          </MmcAction>
          <MmcAction onClick={() => setDialog('membership')} testId="dfs-membership">
            Définir le chemin d’un membre…
          </MmcAction>
          <MmcAction onClick={() => runCommand(command('dfs.sync', group.name))} testId="dfs-sync">
            Répliquer maintenant
          </MmcAction>
        </>
      )}
    </>
  )

  let content
  if (folderName && nsName) {
    const folder = namespaces
      .find((n) => n.namespace.name === nsName)
      ?.namespace.folders.find((f) => f.name === folderName)
    content = (
      <MmcTable
        testId="dfs-targets"
        columns={['Cible', 'État de la référence', '']}
        empty="Aucune cible."
        rows={(folder?.targets ?? []).map((t) => [
          t,
          'Activée',
          <button
            key="del"
            type="button"
            className="text-red-600 hover:underline"
            onClick={() => runCommand(command('dfs.removeTarget', `${nsPath}\\${folderName}`, t))}
          >
            Supprimer
          </button>
        ])}
      />
    )
  } else if (nsName) {
    const ns = namespaces.find((n) => n.namespace.name === nsName)
    content = (
      <MmcTable
        testId="dfs-folders"
        columns={['Dossier', 'Cibles', '']}
        empty="Aucun dossier dans cet espace de noms."
        rows={(ns?.namespace.folders ?? []).map((f) => [
          f.name,
          f.targets.join(', '),
          <button
            key="del"
            type="button"
            className="text-red-600 hover:underline"
            onClick={() => runCommand(command('dfs.removeFolder', `${nsPath}\\${f.name}`))}
          >
            Supprimer
          </button>
        ])}
      />
    )
  } else if (group) {
    content = (
      <MmcTable
        testId="dfs-memberships"
        columns={['Dossier répliqué', 'Membre', 'Chemin local', 'Principal', 'Dernière réplication']}
        empty="Ajoutez des membres et un dossier répliqué, puis le chemin local de chaque membre."
        rows={group.folders.flatMap((f) =>
          Object.entries(f.paths).map(([id, path]) => [
            f.name,
            lab.devices[id]?.name ?? id,
            path,
            f.primary === id ? 'Oui' : '',
            f.lastSync === null ? 'jamais' : 'effectuée'
          ])
        )}
      />
    )
  } else {
    content = (
      <div className="p-4 text-sm text-slate-600">
        <p>
          {namespaces.length} espace(s) de noms et {groups.length} groupe(s) de réplication dans le domaine{' '}
          <b>{domain ?? '—'}</b>.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          La réplication s’effectue en tâche de fond après chaque modification (mode Temps réel) ; « Répliquer
          maintenant » la force.
        </p>
      </div>
    )
  }

  const d = dialog ? forms[dialog] : null
  return (
    <div className="relative h-full">
      <Mmc
        nodes={nodes}
        selected={selected}
        onSelect={setSelected}
        actions={actions}
        testId="dfs-console"
        treeWidth={260}
      >
        {content}
      </Mmc>
      {d && (
        <FormDialog
          title={d.title}
          fields={d.fields}
          onSubmit={d.submit}
          onClose={() => setDialog(null)}
          testId="dfs-dialog"
        />
      )}
    </div>
  )
}
