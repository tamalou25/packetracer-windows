/**
 * Console Sites et services Active Directory (dssite.msc) : sites et leurs serveurs, sous-réseaux,
 * liens de sites IP (coût, intervalle), déplacement d'un contrôleur, « Répliquer maintenant ».
 */
import { useState } from 'react'
import { Building2, Network, Server, Waypoints } from 'lucide-react'
import { command, dcSite, type HostDevice } from '@engine/index'
import { runCommand, runCommandOk } from '../../lib/run'
import { useLabStore } from '../../store/lab'
import { FormDialog } from '../common/FormDialog'
import { Mmc, MmcAction, MmcTable, type MmcNode } from '../mmc/Mmc'

type Dialog = 'site' | 'subnet' | 'link' | 'rename' | { link: string } | { move: string } | null

const rowButton = 'rounded border border-slate-300 px-1.5 py-0.5 text-[11px] hover:bg-slate-100'

export function DssiteApp({ device }: { device: HostDevice }) {
  const lab = useLabStore((s) => s.lab)
  const [node, setNode] = useState('sites')
  const [dialog, setDialog] = useState<Dialog>(null)
  const domain = device.host.domain ? lab.domains[device.host.domain] : undefined
  if (!domain) return <div className="p-4 text-xs">Cet ordinateur n’est membre d’aucun domaine.</div>
  const D = domain.name
  const name = (id: string) => lab.devices[id]?.name ?? id
  const siteNode = node.startsWith('site:') ? node.slice(5) : null

  const nodes: MmcNode[] = [
    {
      id: 'sites',
      label: 'Sites',
      icon: Building2,
      children: [
        { id: 'transports', label: 'Inter-Site Transports › IP', icon: Waypoints },
        { id: 'subnets', label: 'Subnets', icon: Network },
        ...domain.sites.map((s) => ({ id: `site:${s.name}`, label: s.name, icon: Building2 }))
      ]
    }
  ]

  const actions = (
    <>
      <MmcAction onClick={() => setDialog('site')} testId="dssite-new-site">
        Nouveau site…
      </MmcAction>
      <MmcAction onClick={() => setDialog('subnet')} testId="dssite-new-subnet">
        Nouveau sous-réseau…
      </MmcAction>
      <MmcAction onClick={() => setDialog('link')} testId="dssite-new-link">
        Nouveau lien de sites…
      </MmcAction>
      {siteNode && (
        <MmcAction onClick={() => setDialog('rename')} testId="dssite-rename">
          Renommer le site…
        </MmcAction>
      )}
      {domain.controllers.length > 1 && (
        <MmcAction onClick={() => runCommandOk(command('adds.syncReplication', D))} testId="dssite-sync">
          Répliquer maintenant
        </MmcAction>
      )}
    </>
  )

  let content
  if (node === 'subnets') {
    content = (
      <MmcTable
        testId="dssite-subnets"
        columns={['Nom', 'Site', 'Actions']}
        empty="Aucun sous-réseau."
        rows={domain.subnets.map((s) => [
          s.prefix,
          s.site,
          <button
            key="d"
            type="button"
            className={rowButton}
            onClick={() => runCommand(command('adds.removeSubnet', D, s.prefix))}
          >
            Supprimer
          </button>
        ])}
      />
    )
  } else if (node === 'transports') {
    content = (
      <MmcTable
        testId="dssite-links"
        columns={['Nom', 'Sites', 'Coût', 'Intervalle (min)', 'Actions']}
        empty="Aucun lien de sites."
        rows={domain.siteLinks.map((l) => [
          l.name,
          l.sites.join(', '),
          String(l.cost),
          String(l.interval),
          <span key="a" className="flex gap-1">
            <button type="button" className={rowButton} onClick={() => setDialog({ link: l.name })}>
              Propriétés
            </button>
            <button
              type="button"
              className={rowButton}
              onClick={() => runCommand(command('adds.removeSiteLink', D, l.name))}
            >
              Supprimer
            </button>
          </span>
        ])}
      />
    )
  } else if (siteNode) {
    const servers = domain.controllers.filter((id) => dcSite(domain, id) === siteNode)
    content = (
      <MmcTable
        testId="dssite-servers"
        columns={['Serveur', 'Réplication entrante', 'Actions']}
        empty="Aucun contrôleur de domaine dans ce site."
        rows={servers.map((id) => {
          const inbound = domain.replication.status.filter((s) => s.dcId === id)
          const failed = inbound.filter((s) => s.result !== 0)
          return [
            <span key="n" className="flex items-center gap-1">
              <Server size={12} /> {name(id)}
            </span>,
            inbound.length === 0
              ? '—'
              : failed.length === 0
                ? `Réussie (${inbound.map((s) => name(s.partnerId)).join(', ')})`
                : `Échec ${failed[0]?.result} depuis ${failed.map((s) => name(s.partnerId)).join(', ')}`,
            <button key="m" type="button" className={rowButton} onClick={() => setDialog({ move: id })}>
              Déplacer…
            </button>
          ]
        })}
      />
    )
  } else {
    content = (
      <MmcTable
        testId="dssite-sites"
        columns={['Site', 'Contrôleurs', 'Sous-réseaux']}
        empty="Aucun site."
        rows={domain.sites.map((s) => [
          s.name,
          domain.controllers
            .filter((id) => dcSite(domain, id) === s.name)
            .map(name)
            .join(', ') || '—',
          domain.subnets
            .filter((n) => n.site === s.name)
            .map((n) => n.prefix)
            .join(', ') || '—'
        ])}
      />
    )
  }

  const siteOptions = domain.sites.map((s) => ({ value: s.name, label: s.name }))
  const close = () => setDialog(null)
  return (
    <div className="relative h-full">
      <Mmc
        nodes={nodes}
        selected={node}
        onSelect={setNode}
        actions={actions}
        testId="dssite-console"
        treeWidth={240}
      >
        {content}
      </Mmc>
      {dialog === 'site' && (
        <FormDialog
          title="Nouvel objet - Site"
          fields={[{ key: 'name', label: 'Nom', placeholder: 'Lyon' }]}
          onSubmit={(v) => runCommandOk(command('adds.newSite', D, { name: String(v['name']) }))}
          onClose={close}
          testId="dssite-dialog"
        />
      )}
      {dialog === 'rename' && siteNode && (
        <FormDialog
          title="Renommer le site"
          fields={[{ key: 'name', label: 'Nouveau nom', initial: siteNode }]}
          onSubmit={(v) => {
            const ok = runCommandOk(command('adds.renameSite', D, siteNode, String(v['name'])))
            if (ok) setNode(`site:${String(v['name'])}`)
            return ok
          }}
          onClose={close}
          testId="dssite-dialog"
        />
      )}
      {dialog === 'subnet' && (
        <FormDialog
          title="Nouvel objet - Sous-réseau"
          fields={[
            { key: 'prefix', label: 'Préfixe', placeholder: '192.168.20.0/24' },
            { key: 'site', label: 'Site', type: 'select', options: siteOptions }
          ]}
          onSubmit={(v) =>
            runCommandOk(
              command('adds.newSubnet', D, { prefix: String(v['prefix']), site: String(v['site']) })
            )
          }
          onClose={close}
          testId="dssite-dialog"
        />
      )}
      {dialog === 'link' && (
        <FormDialog
          title="Nouvel objet - Lien de sites"
          fields={[
            { key: 'name', label: 'Nom', placeholder: 'Paris-Lyon' },
            { key: 'a', label: 'Premier site', type: 'select', options: siteOptions },
            { key: 'b', label: 'Second site', type: 'select', options: siteOptions },
            { key: 'cost', label: 'Coût', initial: '100' },
            { key: 'interval', label: 'Répliquer toutes les (minutes)', initial: '180' }
          ]}
          onSubmit={(v) =>
            runCommandOk(
              command('adds.newSiteLink', D, {
                name: String(v['name']),
                sites: [String(v['a']), String(v['b'])],
                cost: Number(v['cost']),
                interval: Number(v['interval'])
              })
            )
          }
          onClose={close}
          testId="dssite-dialog"
        />
      )}
      {dialog && typeof dialog === 'object' && 'link' in dialog && (
        <FormDialog
          title={`Propriétés de ${dialog.link}`}
          fields={[
            {
              key: 'cost',
              label: 'Coût',
              initial: String(domain.siteLinks.find((l) => l.name === dialog.link)?.cost ?? 100)
            },
            {
              key: 'interval',
              label: 'Répliquer toutes les (minutes)',
              initial: String(domain.siteLinks.find((l) => l.name === dialog.link)?.interval ?? 180)
            }
          ]}
          onSubmit={(v) =>
            runCommandOk(
              command('adds.setSiteLink', D, dialog.link, {
                cost: Number(v['cost']),
                interval: Number(v['interval'])
              })
            )
          }
          onClose={close}
          testId="dssite-dialog"
        />
      )}
      {dialog && typeof dialog === 'object' && 'move' in dialog && (
        <FormDialog
          title={`Déplacer ${name(dialog.move)}`}
          fields={[{ key: 'site', label: 'Site de destination', type: 'select', options: siteOptions }]}
          onSubmit={(v) => runCommandOk(command('adds.moveDcToSite', D, dialog.move, String(v['site'])))}
          onClose={close}
          testId="dssite-dialog"
        />
      )}
    </div>
  )
}
