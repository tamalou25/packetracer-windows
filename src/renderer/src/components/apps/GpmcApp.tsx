/**
 * Console Gestion des stratégies de groupe : forêt, domaine, unités d'organisation et liaisons,
 * objets GPO (étendue, détails, paramètres), héritage, blocage, liaisons appliquées et filtrage.
 * Toutes les modifications passent par les actions du moteur (mêmes que les cmdlets GroupPolicy).
 */
import { useState, type ReactNode } from 'react'
import {
  Check,
  ChevronDown,
  ChevronUp,
  FileSymlink,
  Folder,
  FolderKey,
  FolderLock,
  Globe,
  ScrollText,
  Trees
} from 'lucide-react'
import {
  AUTHENTICATED_USERS_SID,
  describeSettings,
  formatShortDate,
  gpoPrecedence,
  GPO_STATUS_LABELS,
  GPO_STATUSES,
  linksAt,
  linksOfGpo,
  objectById,
  type Domain,
  type Gpo,
  type GpoStatus,
  type HostDevice,
  command
} from '@engine/index'
import { launch } from '../../lib/desktop'
import { requireAdmin } from '../../lib/directory'
import { runCommand, runCommandOk } from '../../lib/run'
import { useLabStore } from '../../store/lab'
import { DialogBody, DialogFooter, MessageBox, TabStrip, WinButton, WinInput } from '../desktop/shell/classic'
import { Mmc, MmcAction, MmcTable, type MmcNode } from '../mmc/Mmc'

/** Nœud sélectionné dans l'arborescence. */
type Selection =
  | { kind: 'info'; id: string }
  | { kind: 'container'; targetId: string | null }
  | { kind: 'link'; targetId: string | null; gpoId: string }
  | { kind: 'gpo'; gpoId: string }
  | { kind: 'gpos' }

function parseSelection(id: string): Selection {
  if (id === 'dom') return { kind: 'container', targetId: null }
  if (id === 'gpos') return { kind: 'gpos' }
  const [kind, a = '', b = ''] = id.split('|')
  if (kind === 'ou') return { kind: 'container', targetId: a }
  if (kind === 'link') return { kind: 'link', targetId: a === 'root' ? null : a, gpoId: b }
  if (kind === 'gpo') return { kind: 'gpo', gpoId: a }
  return { kind: 'info', id }
}

const linkNodeId = (targetId: string | null, gpoId: string) => `link|${targetId ?? 'root'}|${gpoId}`

/** Nom affiché d'un élément du filtrage de sécurité. */
function principalLabel(domain: Domain, id: string): string {
  if (id === AUTHENTICATED_USERS_SID) return 'Utilisateurs authentifiés'
  const o = objectById(domain, id)
  if (!o || o.kind === 'container') return id
  return o.kind === 'computer' ? `${o.obj.name}$` : `${o.obj.name} (${domain.netbios}\\${o.obj.sam})`
}

type Dialog =
  /** targetId absent : création sans liaison (nœud « Objets de stratégie de groupe »). */
  | { kind: 'create'; targetId?: string | null }
  | { kind: 'linkExisting'; targetId: string | null }
  | { kind: 'rename'; gpo: Gpo }
  | { kind: 'filter'; gpo: Gpo }
  | { kind: 'deleteLink'; gpo: Gpo; targetId: string | null }
  | { kind: 'deleteGpo'; gpo: Gpo }

export function GpmcApp({ device }: { device: HostDevice }) {
  const lab = useLabStore((s) => s.lab)
  const domain: Domain | undefined = device.host.domain ? lab.domains[device.host.domain] : undefined
  const [selected, setSelected] = useState('dom')
  const [dialog, setDialog] = useState<Dialog | null>(null)
  if (!domain)
    return <div className="p-6 text-sm text-slate-500">Cet ordinateur n’est pas membre d’un domaine.</div>

  const sel = parseSelection(selected)
  const gpoById = (id: string) => domain.gpos.find((g) => g.id === id)
  const linkNodes = (targetId: string | null): MmcNode[] =>
    linksAt(domain, targetId).flatMap((l) => {
      const gpo = gpoById(l.gpoId)
      return gpo
        ? [
            {
              id: linkNodeId(targetId, gpo.id),
              label: gpo.name,
              icon: FileSymlink,
              iconClass: l.enabled ? 'text-amber-600' : 'text-slate-400'
            }
          ]
        : []
    })
  const ouNodes = (parentId: string | null): MmcNode[] =>
    domain.containers
      .filter((c) => c.parentId === parentId && c.kind === 'ou')
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      .map((c) => ({
        id: `ou|${c.id}`,
        label: c.name,
        icon: c.blockInheritance ? FolderLock : FolderKey,
        iconClass: c.blockInheritance ? 'text-sky-700' : 'text-amber-600',
        children: [...linkNodes(c.id), ...ouNodes(c.id)]
      }))
  const nodes: MmcNode[] = [
    {
      id: 'root',
      label: 'Gestion de stratégie de groupe',
      icon: ScrollText,
      iconClass: 'text-amber-600',
      children: [
        {
          id: 'forest',
          label: `Forêt : ${domain.name}`,
          icon: Trees,
          iconClass: 'text-emerald-600',
          children: [
            {
              id: 'domains',
              label: 'Domaines',
              icon: Folder,
              children: [
                {
                  id: 'dom',
                  label: domain.name,
                  icon: Globe,
                  iconClass: 'text-sky-600',
                  children: [
                    ...linkNodes(null),
                    ...ouNodes(null),
                    {
                      id: 'gpos',
                      label: 'Objets de stratégie de groupe',
                      icon: Folder,
                      children: [...domain.gpos]
                        .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
                        .map((g) => ({
                          id: `gpo|${g.id}`,
                          label: g.name,
                          icon: ScrollText,
                          iconClass: 'text-amber-600'
                        }))
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]

  /** Exécute une action du moteur si la session administre le domaine. */
  const admin = (fn: () => void) => () => {
    if (requireAdmin(device)) fn()
  }
  const edit = (gpo: Gpo) => admin(() => launch(device.id, 'gpme', { arg: gpo.id }))

  const containerActions = (targetId: string | null) => {
    const ou = targetId === null ? undefined : domain.containers.find((c) => c.id === targetId)
    return (
      <>
        <MmcAction onClick={admin(() => setDialog({ kind: 'create', targetId }))} testId="gpmc-create-link">
          Créer un objet GPO dans ce domaine, et le lier ici…
        </MmcAction>
        <MmcAction
          onClick={admin(() => setDialog({ kind: 'linkExisting', targetId }))}
          testId="gpmc-link-existing"
        >
          Lier un objet de stratégie de groupe existant…
        </MmcAction>
        {ou && (
          <MmcAction
            onClick={admin(() =>
              runCommand(command('gpo.setInheritanceBlocked', domain.name, ou.id, !ou.blockInheritance))
            )}
            testId="gpmc-block"
          >
            <Checked on={ou.blockInheritance}>Bloquer l’héritage</Checked>
          </MmcAction>
        )}
      </>
    )
  }

  const gpoActions = (gpo: Gpo) => (
    <>
      <MmcAction onClick={edit(gpo)} testId="gpmc-edit">
        Modifier…
      </MmcAction>
      <MmcAction onClick={admin(() => setDialog({ kind: 'rename', gpo }))} testId="gpmc-rename">
        Renommer
      </MmcAction>
      <MmcAction danger onClick={admin(() => setDialog({ kind: 'deleteGpo', gpo }))} testId="gpmc-delete">
        Supprimer
      </MmcAction>
    </>
  )

  let actions: ReactNode = null
  let content: ReactNode
  if (sel.kind === 'container') {
    actions = containerActions(sel.targetId)
    content = (
      <ContainerView
        domain={domain}
        targetId={sel.targetId}
        device={device}
        onOpenGpo={(id) => setSelected(linkNodeId(sel.targetId, id))}
      />
    )
  } else if (sel.kind === 'link' || sel.kind === 'gpo') {
    const gpo = gpoById(sel.gpoId)
    const link =
      sel.kind === 'link' ? linksAt(domain, sel.targetId).find((l) => l.gpoId === sel.gpoId) : undefined
    if (!gpo) content = <Empty>L’objet sélectionné n’existe plus.</Empty>
    else {
      actions = (
        <>
          {sel.kind === 'link' && link && (
            <>
              <MmcAction onClick={edit(gpo)} testId="gpmc-edit">
                Modifier…
              </MmcAction>
              <MmcAction
                onClick={admin(() =>
                  runCommand(
                    command('gpo.updateLink', domain.name, gpo.id, sel.targetId, { enforced: !link.enforced })
                  )
                )}
                testId="gpmc-enforce"
              >
                <Checked on={link.enforced}>Appliqué</Checked>
              </MmcAction>
              <MmcAction
                onClick={admin(() =>
                  runCommand(
                    command('gpo.updateLink', domain.name, gpo.id, sel.targetId, { enabled: !link.enabled })
                  )
                )}
                testId="gpmc-link-enabled"
              >
                <Checked on={link.enabled}>Lien activé</Checked>
              </MmcAction>
              <MmcAction
                danger
                onClick={admin(() => setDialog({ kind: 'deleteLink', gpo, targetId: sel.targetId }))}
                testId="gpmc-delete-link"
              >
                Supprimer le lien
              </MmcAction>
            </>
          )}
          {sel.kind === 'gpo' && gpoActions(gpo)}
        </>
      )
      content = (
        <GpoView
          domain={domain}
          gpo={gpo}
          device={device}
          onAddFilter={admin(() => setDialog({ kind: 'filter', gpo }))}
        />
      )
    }
  } else if (sel.kind === 'gpos') {
    actions = (
      <MmcAction onClick={admin(() => setDialog({ kind: 'create' }))} testId="gpmc-new">
        Nouveau…
      </MmcAction>
    )
    content = (
      <div className="p-3">
        <Title>Objets de stratégie de groupe dans {domain.name}</Title>
        <MmcTable
          testId="gpmc-gpo-list"
          columns={['Nom', 'État GPO', 'Filtre WMI', 'Modifié', 'Propriétaire']}
          empty="Aucun objet de stratégie de groupe."
          rows={[...domain.gpos]
            .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
            .map((g) => [
              <button
                key="n"
                type="button"
                className="text-left hover:underline"
                onClick={() => setSelected(`gpo|${g.id}`)}
              >
                {g.name}
              </button>,
              GPO_STATUS_LABELS[g.status],
              'Aucun',
              formatShortDate(g.modifiedAt),
              `Admins du domaine (${domain.netbios}\\Admins du domaine)`
            ])}
        />
      </div>
    )
  } else {
    content = (
      <Empty>
        {sel.id === 'forest' || sel.id === 'domains' || sel.id === 'root'
          ? 'Sélectionnez le domaine, une unité d’organisation ou un objet de stratégie de groupe.'
          : ''}
      </Empty>
    )
  }

  return (
    <div className="relative h-full">
      <Mmc
        nodes={nodes}
        selected={selected}
        onSelect={setSelected}
        actions={actions ?? undefined}
        testId="gpmc"
        treeWidth={270}
      >
        {content}
      </Mmc>
      {dialog && (
        <GpmcDialog
          dialog={dialog}
          domain={domain}
          onClose={() => setDialog(null)}
          onCreated={(id, targetId) =>
            setSelected(targetId === undefined ? `gpo|${id}` : linkNodeId(targetId, id))
          }
          onDeleted={() =>
            setSelected(sel.kind === 'link' ? (sel.targetId === null ? 'dom' : `ou|${sel.targetId}`) : 'gpos')
          }
        />
      )}
    </div>
  )
}

function Checked({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <Check size={12} className={on ? 'text-sky-700' : 'invisible'} />
      {children}
    </span>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="p-6 text-xs text-slate-500">{children}</div>
}

function Title({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 text-sm font-semibold text-[#1e3a5f]">{children}</h2>
}

/** Domaine ou OU : GPO liées (ordre de liaison) et héritage. */
function ContainerView({
  domain,
  targetId,
  device,
  onOpenGpo
}: {
  domain: Domain
  targetId: string | null
  device: HostDevice
  onOpenGpo: (gpoId: string) => void
}) {
  const [tab, setTab] = useState<'links' | 'inheritance'>('links')
  const [row, setRow] = useState<string | null>(null)
  const ou = targetId === null ? undefined : domain.containers.find((c) => c.id === targetId)
  const links = linksAt(domain, targetId)
  const move = (delta: number) => {
    const index = links.findIndex((l) => l.gpoId === row)
    if (index < 0 || !requireAdmin(device)) return
    runCommand(
      command('gpo.updateLink', domain.name, links[index]?.gpoId ?? '', targetId, {
        order: index + 1 + delta
      })
    )
  }
  return (
    <div className="flex h-full flex-col">
      <div className="px-3 pt-3">
        <Title>{ou?.name ?? domain.name}</Title>
      </div>
      <TabStrip
        tabs={[
          { id: 'links', label: 'Objets de stratégie de groupe liés' },
          { id: 'inheritance', label: 'Héritage de stratégie de groupe' }
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'links' ? (
        <div className="flex min-h-0 flex-1 gap-1 p-2">
          <div className="flex flex-col gap-1 pt-6">
            <button
              type="button"
              title="Monter le lien"
              className="rounded border border-slate-300 p-0.5 hover:bg-slate-100"
              onClick={() => move(-1)}
              data-testid="gpmc-link-up"
            >
              <ChevronUp size={14} />
            </button>
            <button
              type="button"
              title="Descendre le lien"
              className="rounded border border-slate-300 p-0.5 hover:bg-slate-100"
              onClick={() => move(1)}
              data-testid="gpmc-link-down"
            >
              <ChevronDown size={14} />
            </button>
          </div>
          <div className="min-w-0 flex-1 overflow-y-auto">
            <MmcTable
              testId="gpmc-links"
              columns={[
                'Ordre des liens',
                'Objet de stratégie de groupe',
                'Appliqué',
                'Lien activé',
                'État GPO',
                'Modifié'
              ]}
              empty="Aucun objet de stratégie de groupe n’est lié ici."
              rows={links.map((l, i) => {
                const gpo = domain.gpos.find((g) => g.id === l.gpoId)
                return [
                  i + 1,
                  <button
                    key="n"
                    type="button"
                    className={`text-left ${row === l.gpoId ? 'font-semibold text-sky-700' : ''}`}
                    onClick={() => setRow(l.gpoId)}
                    onDoubleClick={() => onOpenGpo(l.gpoId)}
                    data-testid={`gpmc-link-row-${gpo?.name ?? l.gpoId}`}
                  >
                    {gpo?.name ?? l.gpoId}
                  </button>,
                  l.enforced ? 'Oui' : 'Non',
                  l.enabled ? 'Oui' : 'Non',
                  gpo ? GPO_STATUS_LABELS[gpo.status] : '',
                  gpo ? formatShortDate(gpo.modifiedAt) : ''
                ]
              })}
            />
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {ou?.blockInheritance && (
            <p className="mb-2 rounded bg-sky-50 px-2 py-1 text-xs text-sky-900" data-testid="gpmc-blocked">
              L’héritage est bloqué : seules les liaisons appliquées des conteneurs parents sont héritées.
            </p>
          )}
          <MmcTable
            testId="gpmc-inheritance"
            columns={['Priorité', 'Objet de stratégie de groupe', 'Emplacement', 'État GPO']}
            empty="Aucun objet de stratégie de groupe ne s’applique ici."
            rows={gpoPrecedence(domain, targetId).map((e, i) => [
              i + 1,
              <span key="n" className="flex items-center gap-1">
                {e.gpo.name}
                {e.link.enforced && <span className="text-[10px] text-sky-700">(appliqué)</span>}
              </span>,
              e.location,
              GPO_STATUS_LABELS[e.gpo.status]
            ])}
          />
        </div>
      )}
    </div>
  )
}

/** Objet GPO : étendue (liaisons, filtrage), détails, paramètres. */
function GpoView({
  domain,
  gpo,
  device,
  onAddFilter
}: {
  domain: Domain
  gpo: Gpo
  device: HostDevice
  onAddFilter: () => void
}) {
  const [tab, setTab] = useState<'scope' | 'details' | 'settings'>('scope')
  const [filterRow, setFilterRow] = useState<string | null>(null)
  return (
    <div className="flex h-full flex-col">
      <div className="px-3 pt-3">
        <Title>{gpo.name}</Title>
      </div>
      <TabStrip
        tabs={[
          { id: 'scope', label: 'Étendue' },
          { id: 'details', label: 'Détails' },
          { id: 'settings', label: 'Paramètres' }
        ]}
        active={tab}
        onChange={setTab}
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs text-black">
        {tab === 'scope' && (
          <div className="flex flex-col gap-3">
            <section>
              <h3 className="mb-1 font-semibold">Liaisons</h3>
              <MmcTable
                testId="gpmc-scope-links"
                columns={['Emplacement', 'Appliqué', 'Lien activé', 'Chemin']}
                empty="Cet objet GPO n’est lié à aucun emplacement."
                rows={linksOfGpo(domain, gpo.id).map((l) => [
                  l.location.split('/').pop() ?? l.location,
                  l.link.enforced ? 'Oui' : 'Non',
                  l.link.enabled ? 'Oui' : 'Non',
                  l.location
                ])}
              />
            </section>
            <section>
              <h3 className="mb-1 font-semibold">Filtrage de sécurité</h3>
              <p className="mb-1 text-slate-600">
                Les paramètres dans cet objet GPO s’appliquent uniquement aux groupes, utilisateurs et
                ordinateurs suivants :
              </p>
              <ul
                className="mb-1.5 max-h-28 overflow-y-auto border border-slate-300 bg-white"
                data-testid="gpmc-filter"
              >
                {gpo.securityFilter.map((p) => (
                  <li key={p}>
                    <button
                      type="button"
                      className={`w-full px-2 py-0.5 text-left ${filterRow === p ? 'bg-[#cce8ff]' : 'hover:bg-[#e5f3ff]'}`}
                      onClick={() => setFilterRow(p)}
                    >
                      {principalLabel(domain, p)}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <WinButton onClick={onAddFilter} data-testid="gpmc-filter-add">
                  Ajouter…
                </WinButton>
                <WinButton
                  disabled={!filterRow || !gpo.securityFilter.includes(filterRow)}
                  onClick={() => {
                    if (!filterRow || !requireAdmin(device)) return
                    const identity =
                      filterRow === AUTHENTICATED_USERS_SID ? filterRow : principalSam(domain, filterRow)
                    runCommand(command('gpo.setSecurityFilter', domain.name, gpo.id, identity, false))
                    setFilterRow(null)
                  }}
                  data-testid="gpmc-filter-remove"
                >
                  Supprimer
                </WinButton>
              </div>
            </section>
            <section>
              <h3 className="mb-1 font-semibold">Filtrage WMI</h3>
              <p className="text-slate-600">Cet objet GPO est lié au filtre WMI suivant : &lt;aucun&gt;</p>
            </section>
          </div>
        )}
        {tab === 'details' && (
          <table className="w-full max-w-xl" data-testid="gpmc-details">
            <tbody>
              {[
                ['Domaine :', domain.name],
                ['Propriétaire :', `Admins du domaine (${domain.netbios}\\Admins du domaine)`],
                ['Créé le :', formatShortDate(gpo.createdAt)],
                ['Modifié le :', formatShortDate(gpo.modifiedAt)],
                ['Version utilisateur :', `${gpo.userVersion} (AD), ${gpo.userVersion} (SysVol)`],
                ['Version ordinateur :', `${gpo.computerVersion} (AD), ${gpo.computerVersion} (SysVol)`],
                ['ID unique :', gpo.id],
                ['Commentaire :', gpo.comment || '—']
              ].map(([k, v]) => (
                <tr key={k}>
                  <td className="w-40 py-1 align-top text-slate-600">{k}</td>
                  <td className="selectable py-1">{v}</td>
                </tr>
              ))}
              <tr>
                <td className="py-1 text-slate-600">État GPO :</td>
                <td className="py-1">
                  <select
                    value={gpo.status}
                    onChange={(e) => {
                      const status = e.target.value as GpoStatus
                      if (requireAdmin(device))
                        runCommand(command('gpo.setStatus', domain.name, gpo.id, status))
                    }}
                    className="h-6 border border-[#7a7a7a] bg-white px-1"
                    data-testid="gpmc-status"
                  >
                    {GPO_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {GPO_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            </tbody>
          </table>
        )}
        {tab === 'settings' && <SettingsReport gpo={gpo} />}
      </div>
    </div>
  )
}

/** Identité utilisable par le moteur pour un élément du filtrage. */
function principalSam(domain: Domain, id: string): string {
  const o = objectById(domain, id)
  if (!o || o.kind === 'container') return id
  return o.kind === 'computer' ? `${o.obj.name}$` : o.obj.sam
}

/** Rapport des paramètres configurés (onglet Paramètres). */
function SettingsReport({ gpo }: { gpo: Gpo }) {
  const part = (title: string, enabled: boolean, lines: ReturnType<typeof describeSettings>) => (
    <section className="mb-3">
      <h3 className="mb-1 border-b border-slate-300 pb-0.5 font-semibold">
        {title} ({enabled ? 'Activée' : 'Désactivée'})
      </h3>
      {lines.length === 0 ? (
        <p className="text-slate-500">Aucun paramètre défini.</p>
      ) : (
        <table className="w-full">
          <tbody>
            {lines.map((l) => (
              <tr key={`${l.category}${l.label}`} className="border-b border-slate-100">
                <td className="py-1 pr-2 align-top text-slate-500">{l.category}</td>
                <td className="py-1 pr-2 align-top">{l.label}</td>
                <td className="selectable py-1 align-top font-medium">{l.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
  return (
    <div data-testid="gpmc-settings">
      {part(
        'Configuration ordinateur',
        gpo.status === 'AllSettingsEnabled' || gpo.status === 'UserSettingsDisabled',
        describeSettings('computer', gpo.computer, gpo.user)
      )}
      {part(
        'Configuration utilisateur',
        gpo.status === 'AllSettingsEnabled' || gpo.status === 'ComputerSettingsDisabled',
        describeSettings('user', gpo.computer, gpo.user)
      )}
    </div>
  )
}

/** Boîtes de dialogue de la console (création, liaison, renommage, filtrage, confirmations). */
function GpmcDialog({
  dialog,
  domain,
  onClose,
  onCreated,
  onDeleted
}: {
  dialog: Dialog
  domain: Domain
  onClose: () => void
  onCreated: (gpoId: string, targetId: string | null | undefined) => void
  onDeleted: () => void
}) {
  const [name, setName] = useState(dialog.kind === 'rename' ? dialog.gpo.name : 'Nouvel objet GPO')
  const [pick, setPick] = useState<string>('')
  if (dialog.kind === 'deleteLink' || dialog.kind === 'deleteGpo') {
    const isLink = dialog.kind === 'deleteLink'
    return (
      <MessageBox
        title="Gestion de stratégie de groupe"
        icon="question"
        testId="gpmc-confirm"
        message={
          isLink
            ? `Voulez-vous supprimer ce lien ?\nCela ne supprimera pas l’objet GPO « ${dialog.gpo.name} » lui-même.`
            : `Voulez-vous supprimer l’objet GPO « ${dialog.gpo.name} » et tous ses liens dans ce domaine ?`
        }
        buttons={[
          {
            label: 'OK',
            primary: true,
            testId: 'gpmc-confirm-ok',
            onClick: () => {
              const ok =
                dialog.kind === 'deleteLink'
                  ? runCommandOk(command('gpo.unlink', domain.name, dialog.gpo.id, dialog.targetId))
                  : runCommandOk(command('gpo.delete', domain.name, dialog.gpo.id))
              onClose()
              if (ok) onDeleted()
            }
          },
          { label: 'Annuler', onClick: onClose, testId: 'gpmc-confirm-cancel' }
        ]}
      />
    )
  }

  let title = ''
  let body: ReactNode = null
  let submit = () => {}
  if (dialog.kind === 'create' || dialog.kind === 'rename') {
    title = dialog.kind === 'create' ? 'Nouvel objet GPO' : 'Renommer l’objet GPO'
    body = (
      <>
        <label className="mb-1 block" htmlFor="gpmc-name">
          Nom :
        </label>
        <WinInput
          id="gpmc-name"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          data-testid="gpmc-name"
        />
        {dialog.kind === 'create' && (
          <>
            <label className="mt-3 mb-1 block">Objet GPO Starter source :</label>
            <select disabled className="h-6 w-full border border-[#cccccc] bg-[#f0f0f0] px-1 text-[#6d6d6d]">
              <option>(aucun)</option>
            </select>
          </>
        )}
      </>
    )
    submit = () => {
      if (dialog.kind === 'rename') {
        if (runCommandOk(command('gpo.rename', domain.name, dialog.gpo.id, name))) onClose()
        return
      }
      const targetId = dialog.targetId
      const createdId = runCommand(command('gpo.createAndLink', domain.name, { name }, targetId))
      if (createdId) {
        onClose()
        onCreated(createdId, targetId)
      }
    }
  } else if (dialog.kind === 'linkExisting') {
    title = 'Sélectionner un objet GPO'
    body = (
      <>
        <p className="mb-1">Rechercher dans ce domaine : {domain.name}</p>
        <p className="mb-1">Objets de stratégie de groupe :</p>
        <ul className="h-40 overflow-y-auto border border-[#7a7a7a] bg-white" data-testid="gpmc-pick-list">
          {[...domain.gpos]
            .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
            .map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  className={`w-full px-2 py-0.5 text-left ${pick === g.id ? 'bg-[#cce8ff]' : 'hover:bg-[#e5f3ff]'}`}
                  onClick={() => setPick(g.id)}
                  onDoubleClick={() => setPick(g.id)}
                  data-testid={`gpmc-pick-${g.name}`}
                >
                  {g.name}
                </button>
              </li>
            ))}
        </ul>
      </>
    )
    submit = () => {
      if (!pick) return
      if (runCommand(command('gpo.link', domain.name, pick, dialog.targetId)) !== undefined) {
        onClose()
        onCreated(pick, dialog.targetId)
      }
    }
  } else if (dialog.kind === 'filter') {
    title = 'Sélectionnez l’utilisateur, l’ordinateur ou le groupe'
    const options = [
      { value: 'Utilisateurs authentifiés', label: 'Utilisateurs authentifiés' },
      ...domain.groups.map((g) => ({ value: g.sam, label: `${g.name} (groupe)` })),
      ...domain.users.map((u) => ({ value: u.sam, label: `${u.name} (utilisateur)` })),
      ...domain.computers.map((c) => ({ value: `${c.name}$`, label: `${c.name} (ordinateur)` }))
    ]
    body = (
      <>
        <p className="mb-1">Entrez le nom de l’objet à sélectionner :</p>
        <select
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          className="h-6 w-full border border-[#7a7a7a] bg-white px-1"
          data-testid="gpmc-filter-principal"
        >
          <option value="">—</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </>
    )
    submit = () => {
      if (!pick) return
      if (runCommand(command('gpo.setSecurityFilter', domain.name, dialog.gpo.id, pick, true)) !== undefined)
        onClose()
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/10">
      <div
        className="flex w-[420px] flex-col border border-[#8a8a8a] bg-[#f0f0f0] shadow-xl"
        data-testid="gpmc-dialog"
      >
        <div className="flex h-7 items-center bg-white px-2 text-xs text-black">{title}</div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <DialogBody>{body}</DialogBody>
          <DialogFooter>
            <WinButton primary type="submit" data-testid="gpmc-dialog-ok">
              OK
            </WinButton>
            <WinButton onClick={onClose}>Annuler</WinButton>
          </DialogFooter>
        </form>
      </div>
    </div>
  )
}
