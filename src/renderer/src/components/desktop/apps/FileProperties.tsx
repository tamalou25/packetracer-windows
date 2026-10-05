/**
 * Propriétés d'un dossier ou d'un fichier du serveur : Général, Partage (partage avancé et
 * autorisations de partage), Sécurité (autorisations NTFS explicites et héritées, héritage) et
 * Accès effectif (droits d'un compte, limités par le partage et/ou par NTFS).
 */
import { useState } from 'react'
import {
  canonicalAcl,
  childrenOf,
  effectiveAccess,
  effectiveAcl,
  findNode,
  NTFS_RIGHT_LABELS,
  NTFS_RIGHTS,
  nodePath,
  principalName,
  principalToken,
  resolvePrincipal,
  SHARE_RIGHT_LABELS,
  formatShortDate,
  type FsNode,
  type HostDevice,
  type LabState,
  type NtfsRight,
  type ServerDevice,
  type ShareAce,
  type ShareRight,
  type SmbShare,
  command,
  batch
} from '@engine/index'
import { accountOptions, displaySize, explorerToken, fileType } from '../../../lib/explorer'
import { runCommandOk } from '../../../lib/run'
import { useLabStore } from '../../../store/lab'
import { useAppWindow } from '../shell/AppWindow'
import {
  DialogBody,
  DialogFooter,
  GroupBox,
  MessageBox,
  TabStrip,
  WinButton,
  WinInput,
  winInputClass
} from '../shell/classic'

type Tab = 'general' | 'sharing' | 'security' | 'effective'

/** Droits inclus dans chaque autorisation de base (cases de l'onglet Sécurité). */
const IMPLIES: Record<NtfsRight, NtfsRight[]> = {
  FullControl: [...NTFS_RIGHTS],
  Modify: ['Modify', 'ReadAndExecute', 'ListDirectory', 'Read', 'Write'],
  ReadAndExecute: ['ReadAndExecute', 'ListDirectory', 'Read'],
  ListDirectory: ['ListDirectory'],
  Read: ['Read'],
  Write: ['Write']
}

function expand(rights: NtfsRight[]): Set<NtfsRight> {
  return new Set(rights.flatMap((r) => IMPLIES[r]))
}

/** Coche ou décoche une autorisation en respectant les inclusions (Modifier inclut Lecture…). */
function toggle(current: Set<NtfsRight>, right: NtfsRight, on: boolean): NtfsRight[] {
  const next = new Set(current)
  if (on) for (const r of IMPLIES[right]) next.add(r)
  else for (const r of NTFS_RIGHTS) if (IMPLIES[r].includes(right)) next.delete(r)
  if (NTFS_RIGHTS.every((r) => next.has(r))) next.add('FullControl')
  return [...next]
}

export function FileProperties({ device, path }: { device: HostDevice; path: string | undefined }) {
  const lab = useLabStore((s) => s.lab)
  const win = useAppWindow()
  const [tab, setTab] = useState<Tab>('general')
  if (device.kind !== 'server' || !path)
    return <div className="p-6 text-sm text-slate-500">Propriétés indisponibles.</div>
  const node = findNode(device.storage, path)
  if (node === undefined)
    return <div className="p-6 text-sm text-slate-500">L’élément « {path} » n’existe plus.</div>
  const isFolder = !node || node.kind === 'folder'
  const tabs: { id: Tab; label: string }[] = [
    { id: 'general', label: 'Général' },
    ...(isFolder && node ? [{ id: 'sharing' as const, label: 'Partage' }] : []),
    { id: 'security', label: 'Sécurité' },
    { id: 'effective', label: 'Accès effectif' }
  ]
  return (
    <div className="flex h-full flex-col bg-[#f0f0f0]" data-testid="fileprops">
      <div className="pt-2">
        <TabStrip tabs={tabs} active={tab} onChange={setTab} />
      </div>
      <DialogBody className="bg-white">
        {tab === 'general' && <General server={device} node={node} path={path} />}
        {tab === 'sharing' && node && <Sharing lab={lab} server={device} node={node} path={path} />}
        {tab === 'security' && <Security lab={lab} server={device} node={node} path={path} />}
        {tab === 'effective' && <Effective lab={lab} server={device} node={node} />}
      </DialogBody>
      <DialogFooter>
        <WinButton primary onClick={() => win?.close()} data-testid="fileprops-ok">
          OK
        </WinButton>
        <WinButton onClick={() => win?.close()}>Annuler</WinButton>
      </DialogFooter>
    </div>
  )
}

function General({ server, node, path }: { server: ServerDevice; node: FsNode | null; path: string }) {
  const all = (id: string | null): FsNode[] =>
    childrenOf(server.storage, id).flatMap((c) => [c, ...(c.kind === 'folder' ? all(c.id) : [])])
  const descendants = all(node?.id ?? null)
  const files = descendants.filter((d) => d.kind === 'file')
  const size = node?.kind === 'file' ? node.size : files.reduce((s, f) => s + f.size, 0)
  const rows: [string, string][] = [
    ['Type :', node ? fileType(node.name, node.kind) : 'Disque local'],
    ['Emplacement :', node ? nodePath(server.storage, node.parentId) : 'C:\\'],
    ['Taille :', displaySize(size)],
    ...(node?.kind !== 'file'
      ? ([['Contenu :', `${files.length} fichier(s), ${descendants.length - files.length} dossier(s)`]] as [
          string,
          string
        ][])
      : []),
    ['Modifié le :', node ? formatShortDate(node.modifiedAt) : '—']
  ]
  return (
    <div className="flex flex-col gap-3" data-testid="fileprops-general">
      <div className="text-sm font-semibold">{node?.name ?? path}</div>
      <table>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className="w-28 py-1 align-top text-[#555]">{k}</td>
              <td className="selectable py-1">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Onglet Partage : état, chemin réseau, partage avancé et autorisations de partage. */
function Sharing({
  lab,
  server,
  node,
  path
}: {
  lab: LabState
  server: ServerDevice
  node: FsNode
  path: string
}) {
  const shares = server.storage.shares.filter((s) => s.folderId === node.id)
  const [advanced, setAdvanced] = useState(false)
  return (
    <div className="flex flex-col gap-3" data-testid="fileprops-sharing">
      <GroupBox label="Partage de fichiers et de dossiers en réseau">
        <div className="flex items-center gap-2 py-1">
          <span className="font-semibold">{node.name}</span>
          <span className="text-[#555]" data-testid="sharing-state">
            {shares.length > 0 ? 'Partagé' : 'Non partagé'}
          </span>
        </div>
        <p className="text-[#555]">Chemin réseau :</p>
        <p className="selectable" data-testid="sharing-path">
          {shares.length > 0 ? shares.map((s) => `\\\\${server.name}\\${s.name}`).join(', ') : 'Non partagé'}
        </p>
      </GroupBox>
      <GroupBox label="Partage avancé">
        <p className="mb-2">
          Définir des autorisations personnalisées, créer plusieurs partages et définir d’autres options de
          partage avancées.
        </p>
        <WinButton onClick={() => setAdvanced(true)} data-testid="sharing-advanced">
          Partage avancé…
        </WinButton>
      </GroupBox>
      {advanced && (
        <AdvancedSharing
          lab={lab}
          server={server}
          node={node}
          path={path}
          shares={shares}
          onClose={() => setAdvanced(false)}
        />
      )}
    </div>
  )
}

function AdvancedSharing({
  lab,
  server,
  node,
  path,
  shares,
  onClose
}: {
  lab: LabState
  server: ServerDevice
  node: FsNode
  path: string
  shares: SmbShare[]
  onClose: () => void
}) {
  const existing = shares[0]
  const [enabled, setEnabled] = useState(!!existing)
  const [name, setName] = useState(existing?.name ?? node.name)
  const [comment, setComment] = useState(existing?.description ?? '')
  const [acl, setAcl] = useState<ShareAce[]>(
    existing?.acl ?? [{ principal: 'S-1-1-0', type: 'Allow', rights: 'Read' }]
  )
  const [permissions, setPermissions] = useState(false)
  const token = explorerToken(lab, server)
  const apply = (): boolean => {
    if (!enabled)
      return existing ? runCommandOk(command('files.removeShare', server.id, existing.name, token)) : true
    if (!existing)
      return runCommandOk(
        batch(`Partager ${path} sous ${name}`, [
          command('files.createShare', server.id, { name, path, description: comment }, token),
          command('files.setShareAcl', server.id, name, acl, token)
        ])
      )
    return runCommandOk(command('files.setShareAcl', server.id, existing.name, acl, token))
  }
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/10">
      <div
        className="flex w-[400px] flex-col border border-[#8a8a8a] bg-[#f0f0f0] shadow-xl"
        data-testid="advanced-sharing"
      >
        <div className="flex h-7 items-center bg-white px-2">Partage avancé</div>
        <DialogBody className="flex flex-col gap-2">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              data-testid="share-enable"
            />
            Partager ce dossier
          </label>
          <GroupBox label="Paramètres">
            <label className="mb-1 block">Nom du partage :</label>
            <WinInput
              value={name}
              disabled={!enabled || !!existing}
              onChange={(e) => setName(e.target.value)}
              data-testid="share-name"
            />
            <label className="mt-2 mb-1 block">Commentaires :</label>
            <WinInput
              value={comment}
              disabled={!enabled || !!existing}
              onChange={(e) => setComment(e.target.value)}
            />
            <div className="mt-2">
              <WinButton
                disabled={!enabled}
                onClick={() => setPermissions(true)}
                data-testid="share-permissions"
              >
                Autorisations
              </WinButton>
            </div>
          </GroupBox>
        </DialogBody>
        <DialogFooter>
          <WinButton
            primary
            onClick={() => {
              if (apply()) onClose()
            }}
            data-testid="share-ok"
          >
            OK
          </WinButton>
          <WinButton onClick={onClose}>Annuler</WinButton>
        </DialogFooter>
      </div>
      {permissions && (
        <SharePermissions
          lab={lab}
          server={server}
          title={`Autorisations pour ${name}`}
          acl={acl}
          onClose={() => setPermissions(false)}
          onSave={(next) => {
            setAcl(next)
            setPermissions(false)
          }}
        />
      )}
    </div>
  )
}

/** Autorisations de partage : Contrôle total ⊃ Modifier ⊃ Lecture, Autoriser / Refuser. */
function SharePermissions({
  lab,
  server,
  title,
  acl,
  onSave,
  onClose
}: {
  lab: LabState
  server: ServerDevice
  title: string
  acl: ShareAce[]
  onSave: (acl: ShareAce[]) => void
  onClose: () => void
}) {
  const [entries, setEntries] = useState<ShareAce[]>(acl)
  const principals = [...new Set(entries.map((e) => e.principal))]
  const [selected, setSelected] = useState<string | null>(principals[0] ?? null)
  const [adding, setAdding] = useState('')
  const has = (type: 'Allow' | 'Deny', right: ShareRight) => {
    const order: ShareRight[] = ['Read', 'Change', 'Full']
    return entries.some(
      (e) => e.principal === selected && e.type === type && order.indexOf(e.rights) >= order.indexOf(right)
    )
  }
  const set = (type: 'Allow' | 'Deny', right: ShareRight, on: boolean) => {
    if (!selected) return
    const order: ShareRight[] = ['Read', 'Change', 'Full']
    const current = entries.find((e) => e.principal === selected && e.type === type)
    const level = current ? order.indexOf(current.rights) : -1
    const target = on ? Math.max(level, order.indexOf(right)) : order.indexOf(right) - 1
    const others = entries.filter((e) => !(e.principal === selected && e.type === type))
    setEntries(
      target < 0 ? others : [...others, { principal: selected, type, rights: order[target] as ShareRight }]
    )
  }
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/10">
      <div
        className="flex w-[380px] flex-col border border-[#8a8a8a] bg-[#f0f0f0] shadow-xl"
        data-testid="share-acl"
      >
        <div className="flex h-7 items-center bg-white px-2">{title}</div>
        <DialogBody className="flex flex-col gap-2">
          <p>Noms de groupes ou d’utilisateurs :</p>
          <ul className="h-24 overflow-y-auto border border-[#7a7a7a] bg-white">
            {principals.map((p) => (
              <li key={p}>
                <button
                  type="button"
                  className={`w-full px-2 py-0.5 text-left ${selected === p ? 'bg-[#cce8ff]' : 'hover:bg-[#e5f3ff]'}`}
                  onClick={() => setSelected(p)}
                  data-testid={`share-acl-principal-${principalName(lab, server, p)}`}
                >
                  {principalName(lab, server, p)}
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <select
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              className={`${winInputClass} flex-1`}
              data-testid="share-acl-add-select"
            >
              <option value="">Ajouter un compte…</option>
              {accountOptions(lab, server).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <WinButton
              disabled={!adding}
              onClick={() => {
                const id = resolvePrincipal(lab, server, adding)
                if (!id) return
                if (!entries.some((e) => e.principal === id))
                  setEntries([...entries, { principal: id, type: 'Allow', rights: 'Read' }])
                setSelected(id)
                setAdding('')
              }}
              data-testid="share-acl-add"
            >
              Ajouter
            </WinButton>
            <WinButton
              disabled={!selected}
              onClick={() => {
                setEntries(entries.filter((e) => e.principal !== selected))
                setSelected(null)
              }}
              data-testid="share-acl-remove"
            >
              Supprimer
            </WinButton>
          </div>
          {selected && (
            <table className="w-full">
              <thead>
                <tr className="text-[#555]">
                  <th className="text-left font-normal">
                    Autorisations pour {principalName(lab, server, selected)}
                  </th>
                  <th className="w-16 font-normal">Autoriser</th>
                  <th className="w-16 font-normal">Refuser</th>
                </tr>
              </thead>
              <tbody>
                {(['Full', 'Change', 'Read'] as ShareRight[]).map((r) => (
                  <tr key={r}>
                    <td className="py-0.5">{SHARE_RIGHT_LABELS[r]}</td>
                    {(['Allow', 'Deny'] as const).map((type) => (
                      <td key={type} className="text-center">
                        <input
                          type="checkbox"
                          checked={has(type, r)}
                          onChange={(e) => set(type, r, e.target.checked)}
                          data-testid={`share-acl-${type === 'Allow' ? 'allow' : 'deny'}-${r}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </DialogBody>
        <DialogFooter>
          <WinButton primary onClick={() => onSave(entries)} data-testid="share-acl-ok">
            OK
          </WinButton>
          <WinButton onClick={onClose}>Annuler</WinButton>
        </DialogFooter>
      </div>
    </div>
  )
}

/** Onglet Sécurité : comptes, autorisations explicites / héritées, héritage. */
function Security({
  lab,
  server,
  node,
  path
}: {
  lab: LabState
  server: ServerDevice
  node: FsNode | null
  path: string
}) {
  const entries = canonicalAcl(effectiveAcl(server.storage, node?.id ?? null))
  const principals = [...new Set(entries.map((e) => e.ace.principal))]
  const [selected, setSelected] = useState<string | null>(principals[0] ?? null)
  const [adding, setAdding] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [inheritance, setInheritance] = useState(false)
  const token = explorerToken(lab, server)
  const mine = entries.filter((e) => e.ace.principal === selected)
  const explicitAllow = expand(
    mine.filter((e) => !e.inherited && e.ace.type === 'Allow').map((e) => e.ace.rights)
  )
  const explicitDeny = expand(
    mine.filter((e) => !e.inherited && e.ace.type === 'Deny').map((e) => e.ace.rights)
  )
  const inheritedAllow = expand(
    mine.filter((e) => e.inherited && e.ace.type === 'Allow').map((e) => e.ace.rights)
  )
  const inheritedDeny = expand(
    mine.filter((e) => e.inherited && e.ace.type === 'Deny').map((e) => e.ace.rights)
  )
  const save = (allow: NtfsRight[], deny: NtfsRight[]) =>
    selected && runCommandOk(command('files.setNtfsEntry', server.id, path, selected, { allow, deny }, token))

  return (
    <div className="flex flex-col gap-2" data-testid="fileprops-security">
      <p>
        Nom de l’objet : <span className="selectable">{path}</span>
      </p>
      <p>Noms de groupes ou d’utilisateurs :</p>
      <ul className="h-28 overflow-y-auto border border-[#7a7a7a] bg-white" data-testid="security-principals">
        {principals.map((p) => (
          <li key={p}>
            <button
              type="button"
              className={`w-full px-2 py-0.5 text-left ${selected === p ? 'bg-[#cce8ff]' : 'hover:bg-[#e5f3ff]'}`}
              onClick={() => setSelected(p)}
              data-testid={`security-principal-${principalName(lab, server, p)}`}
            >
              {principalName(lab, server, p)}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <select
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          className={`${winInputClass} flex-1`}
          data-testid="security-add-select"
        >
          <option value="">Ajouter un compte…</option>
          {accountOptions(lab, server).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <WinButton
          disabled={!adding}
          onClick={() => {
            const id = resolvePrincipal(lab, server, adding)
            if (!id) return
            // Comme dans l'interface réelle : Lecture et exécution par défaut
            if (
              runCommandOk(
                command(
                  'files.setNtfsEntry',
                  server.id,
                  path,
                  id,
                  { allow: ['ReadAndExecute'], deny: [] },
                  token
                )
              )
            )
              setSelected(id)
            setAdding('')
          }}
          data-testid="security-add"
        >
          Ajouter
        </WinButton>
        <WinButton
          disabled={!selected}
          onClick={() => {
            if (!selected) return
            if (mine.every((e) => e.inherited)) {
              setMessage(
                `Vous ne pouvez pas supprimer l’objet ${principalName(lab, server, selected)}, car il hérite des autorisations de son parent. Pour supprimer l’objet, vous devez empêcher l’héritage des autorisations.`
              )
              return
            }
            runCommandOk(
              command('files.removeNtfs', server.id, path, principalName(lab, server, selected), 'all', token)
            )
          }}
          data-testid="security-remove"
        >
          Supprimer
        </WinButton>
      </div>
      {selected && (
        <table className="w-full" data-testid="security-rights">
          <thead>
            <tr className="text-[#555]">
              <th className="text-left font-normal">
                Autorisations pour {principalName(lab, server, selected)}
              </th>
              <th className="w-16 font-normal">Autoriser</th>
              <th className="w-16 font-normal">Refuser</th>
            </tr>
          </thead>
          <tbody>
            {NTFS_RIGHTS.filter((r) => node?.kind !== 'file' || r !== 'ListDirectory').map((r) => (
              <tr key={r}>
                <td className="py-0.5">{NTFS_RIGHT_LABELS[r]}</td>
                <td className="text-center">
                  <input
                    type="checkbox"
                    checked={explicitAllow.has(r) || inheritedAllow.has(r)}
                    disabled={inheritedAllow.has(r) && !explicitAllow.has(r)}
                    onChange={(e) => save(toggle(explicitAllow, r, e.target.checked), [...explicitDeny])}
                    data-testid={`security-allow-${r}`}
                  />
                </td>
                <td className="text-center">
                  <input
                    type="checkbox"
                    checked={explicitDeny.has(r) || inheritedDeny.has(r)}
                    disabled={inheritedDeny.has(r) && !explicitDeny.has(r)}
                    onChange={(e) => save([...explicitAllow], toggle(explicitDeny, r, e.target.checked))}
                    data-testid={`security-deny-${r}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-[11px] text-[#555]">
        Les cases grisées correspondent à des autorisations héritées du dossier parent.
      </p>
      {node && (
        <div className="flex items-center gap-2">
          <span data-testid="security-inheritance-state">
            Héritage : {node.inherits ? 'activé (autorisations du dossier parent incluses)' : 'désactivé'}
          </span>
          <WinButton onClick={() => setInheritance(true)} data-testid="security-advanced">
            Avancé
          </WinButton>
        </div>
      )}
      {message && (
        <MessageBox
          title="Sécurité"
          icon="error"
          message={message}
          testId="security-message"
          buttons={[
            { label: 'OK', primary: true, onClick: () => setMessage(null), testId: 'security-message-ok' }
          ]}
        />
      )}
      {inheritance && node && (
        <MessageBox
          title="Paramètres de sécurité avancés"
          icon="question"
          testId="security-inheritance"
          message={
            node.inherits
              ? 'Que voulez-vous faire des autorisations héritées actuelles ?\n\nVous êtes sur le point de bloquer l’héritage de cet objet : les autorisations héritées d’un objet parent ne seront plus appliquées.'
              : 'Activer l’héritage : les autorisations du dossier parent s’appliqueront de nouveau à cet objet, en plus de ses autorisations explicites.'
          }
          buttons={
            node.inherits
              ? [
                  {
                    label: 'Convertir en autorisations explicites',
                    primary: true,
                    testId: 'inheritance-convert',
                    onClick: () => {
                      runCommandOk(command('files.setNtfsInheritance', server.id, path, 'convert', token))
                      setInheritance(false)
                    }
                  },
                  {
                    label: 'Supprimer les autorisations héritées',
                    testId: 'inheritance-remove',
                    onClick: () => {
                      runCommandOk(command('files.setNtfsInheritance', server.id, path, 'remove', token))
                      setInheritance(false)
                    }
                  },
                  { label: 'Annuler', onClick: () => setInheritance(false) }
                ]
              : [
                  {
                    label: 'Activer l’héritage',
                    primary: true,
                    testId: 'inheritance-enable',
                    onClick: () => {
                      runCommandOk(command('files.setNtfsInheritance', server.id, path, 'enable', token))
                      setInheritance(false)
                    }
                  },
                  { label: 'Annuler', onClick: () => setInheritance(false) }
                ]
          }
        />
      )}
    </div>
  )
}

/** Onglet Accès effectif : droits d'un compte, limités par le partage et/ou NTFS. */
function Effective({ lab, server, node }: { lab: LabState; server: ServerDevice; node: FsNode | null }) {
  const [account, setAccount] = useState('')
  const [shareName, setShareName] = useState('')
  const [shown, setShown] = useState<{ account: string; share: string } | null>(null)
  // Partages donnant accès à cet élément (le dossier lui-même ou un dossier parent)
  const shares = server.storage.shares.filter((s) => {
    let current: string | null = node?.id ?? null
    while (current) {
      if (current === s.folderId) return true
      current = server.storage.nodes.find((n) => n.id === current)?.parentId ?? null
    }
    return false
  })
  const principal = shown ? resolvePrincipal(lab, server, shown.account) : undefined
  const token = principal ? principalToken(lab, server, principal) : null
  const share = shown?.share ? shares.find((s) => s.name === shown.share) : undefined
  const rows = token ? effectiveAccess(server.storage, node?.id ?? null, token, share) : []
  return (
    <div className="flex flex-col gap-2" data-testid="fileprops-effective">
      <p>
        L’accès effectif vous permet de voir les autorisations d’un utilisateur ou d’un groupe en fonction des
        autorisations accordées directement et par le biais de l’appartenance aux groupes.
      </p>
      <label className="flex items-center gap-2">
        <span className="w-32">Utilisateur/groupe :</span>
        <select
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          className={`${winInputClass} flex-1`}
          data-testid="effective-account"
        >
          <option value="">Sélectionner un utilisateur…</option>
          {accountOptions(lab, server).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {shares.length > 0 && (
        <label className="flex items-center gap-2">
          <span className="w-32">Inclure un partage :</span>
          <select
            value={shareName}
            onChange={(e) => setShareName(e.target.value)}
            className={`${winInputClass} flex-1`}
            data-testid="effective-share"
          >
            <option value="">(accès local uniquement)</option>
            {shares.map((s) => (
              <option key={s.name} value={s.name}>
                \\{server.name}\{s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div>
        <WinButton
          disabled={!account}
          onClick={() => setShown({ account, share: shareName })}
          data-testid="effective-show"
        >
          Afficher l’accès effectif
        </WinButton>
      </div>
      {shown && (
        <table className="w-full border border-[#d9d9d9] bg-white" data-testid="effective-table">
          <thead className="bg-[#f5f5f5] text-left text-[#555]">
            <tr>
              <th className="w-14 px-2 py-1 font-normal">Accès</th>
              <th className="px-2 py-1 font-normal">Autorisation</th>
              <th className="px-2 py-1 font-normal">Accès limité par</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.perm} className="border-t border-[#eee]" data-testid={`effective-${r.perm}`}>
                <td
                  className={`px-2 py-0.5 font-semibold ${r.allowed ? 'text-[#107c10]' : 'text-[#c42b1c]'}`}
                >
                  {r.allowed ? '✓' : '✗'}
                </td>
                <td className="px-2 py-0.5">{r.label}</td>
                <td className="px-2 py-0.5 text-[#555]">{r.limitedBy.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
