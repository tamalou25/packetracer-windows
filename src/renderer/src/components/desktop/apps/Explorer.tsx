/**
 * Explorateur de fichiers : « Ce PC » (disque local, lecteurs réseau), dossiers locaux d'un
 * serveur et partages réseau (\\serveur\partage), création, suppression, propriétés,
 * connexion de lecteurs réseau. Les accès réseau sont tracés (SMB) en mode Simulation.
 */
import { useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Computer,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  HardDrive,
  Network,
  Settings2,
  Trash2,
  Unplug
} from 'lucide-react'
import {
  createItem,
  formatShortDate,
  mapDrive,
  parseUnc,
  removeItem,
  sessionDrives,
  unmapDrive,
  type FsNode,
  type HostDevice
} from '@engine/index'
import { launch } from '../../../lib/desktop'
import {
  displaySize,
  explorerToken,
  fileType,
  joinLocation,
  parentLocation,
  resolveLocation,
  THIS_PC,
  type ExplorerView
} from '../../../lib/explorer'
import { runNetworkOperation } from '../../../lib/network'
import { useLabStore } from '../../../store/lab'
import { useAppWindow } from '../shell/AppWindow'
import { DialogBody, DialogFooter, MessageBox, WinButton, WinInput, winInputClass } from '../shell/classic'

type Dialog =
  | { kind: 'name'; what: 'folder' | 'file' }
  | { kind: 'delete'; item: FsNode }
  | { kind: 'map' }
  | { kind: 'message'; title: string; message: string; icon: 'error' | 'warning' | 'info' }
  | null

const LETTERS = 'ZYXWVUTSRQPONMLKJIHGFED'.split('')

export function Explorer({ device, initial }: { device: HostDevice; initial?: string }) {
  const lab = useLabStore((s) => s.lab)
  const win = useAppWindow()
  const [location, setLocation] = useState(initial && initial !== 'thispc' ? initial : THIS_PC)
  const [history, setHistory] = useState<string[]>([])
  const [future, setFuture] = useState<string[]>([])
  const [address, setAddress] = useState(location)
  const [selected, setSelected] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const token = explorerToken(lab, device)
  const view = resolveLocation(lab, device, location)
  const drives = sessionDrives(device, token.account)

  /** Ouvre un emplacement : les accès réseau sont rejoués en mode Simulation. */
  const navigate = (target: string, push = true) => {
    const next = target.trim() === '' ? THIS_PC : target.trim()
    // État courant du lab (un lecteur vient peut-être d'être connecté)
    const current = useLabStore.getState().lab
    const fresh = current.devices[device.id]
    const resolved = resolveLocation(
      current,
      fresh && (fresh.kind === 'server' || fresh.kind === 'client') ? fresh : device,
      next
    )
    if (resolved.kind === 'error') {
      setDialog({ kind: 'message', title: resolved.title, message: resolved.message, icon: 'error' })
      setAddress(location)
      return
    }
    const commit = () => {
      if (push && next !== location) {
        setHistory([...history, location])
        setFuture([])
      }
      setLocation(next)
      setAddress(next)
      setSelected(null)
    }
    if (resolved.kind === 'folder' && resolved.trace) runNetworkOperation(resolved.trace, commit)
    else commit()
  }

  const fail = (message: string) =>
    setDialog({
      kind: 'message',
      title: 'Explorateur de fichiers',
      message:
        message === 'Accès refusé.'
          ? 'Vous devez disposer d’une autorisation pour effectuer cette action.'
          : message,
      icon: 'error'
    })

  const folder = view.kind === 'folder' ? view : null
  const selectedItem = folder?.items.find((i) => i.id === selected) ?? null
  const canWrite = !!folder?.perms.has('write')

  const create = (what: 'folder' | 'file', name: string) => {
    if (!folder) return
    const r = createItem(lab, folder.server.id, joinLocation(folder.localPath, name), what, token, {
      ...(folder.share ? { share: folder.share.name } : {})
    })
    if (!r.ok) return fail(r.error.message)
    useLabStore.getState().run(() => r)
    setDialog(null)
  }

  const remove = (item: FsNode) => {
    if (!folder) return
    const r = removeItem(lab, folder.server.id, joinLocation(folder.localPath, item.name), token, {
      recurse: true,
      ...(folder.share ? { share: folder.share.name } : {})
    })
    setDialog(null)
    if (!r.ok) return fail(r.error.message)
    useLabStore.getState().run(() => r)
    setSelected(null)
  }

  const properties = (item: FsNode | null) => {
    if (!folder || folder.share || folder.server.id !== device.id) return
    const path = item ? joinLocation(folder.localPath, item.name) : folder.localPath
    launch(device.id, 'fileprops', { arg: path, ...(win ? { parent: win.win.id } : {}) })
  }

  const local = !!folder && !folder.share && folder.server.id === device.id

  const toolbarButton = (
    label: string,
    icon: ReactNode,
    onClick: () => void,
    testId: string,
    disabled = false
  ) => (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-1 rounded-sm px-2 py-1 hover:bg-[#e5f3ff] disabled:text-[#a0a0a0] disabled:hover:bg-transparent"
      data-testid={testId}
    >
      {icon}
      {label}
    </button>
  )

  return (
    <div className="relative flex h-full flex-col bg-white text-xs text-black" data-testid="explorer">
      {/* Ruban simplifié */}
      <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-[#e5e5e5] bg-[#f5f6f7] px-2 py-1">
        {view.kind === 'thispc' ? (
          toolbarButton(
            'Connecter un lecteur réseau',
            <Network size={14} className="text-sky-700" />,
            () => setDialog({ kind: 'map' }),
            'explorer-map-drive'
          )
        ) : (
          <>
            {toolbarButton(
              'Nouveau dossier',
              <FolderPlus size={14} className="text-amber-600" />,
              () => setDialog({ kind: 'name', what: 'folder' }),
              'explorer-new-folder',
              !canWrite
            )}
            {toolbarButton(
              'Nouveau document texte',
              <FilePlus size={14} className="text-sky-700" />,
              () => setDialog({ kind: 'name', what: 'file' }),
              'explorer-new-file',
              !canWrite
            )}
            {toolbarButton(
              'Supprimer',
              <Trash2 size={14} className="text-red-600" />,
              () => selectedItem && setDialog({ kind: 'delete', item: selectedItem }),
              'explorer-delete',
              !selectedItem
            )}
            {toolbarButton(
              'Propriétés',
              <Settings2 size={14} className="text-slate-600" />,
              () => properties(selectedItem),
              'explorer-properties',
              !local
            )}
          </>
        )}
      </div>
      {/* Navigation et barre d'adresse */}
      <div className="flex shrink-0 items-center gap-1 border-b border-[#e5e5e5] px-2 py-1">
        <button
          type="button"
          disabled={history.length === 0}
          onClick={() => {
            const previous = history[history.length - 1]
            if (previous === undefined) return
            setHistory(history.slice(0, -1))
            setFuture([location, ...future])
            navigate(previous, false)
          }}
          className="rounded p-1 hover:bg-[#e5f3ff] disabled:text-[#c0c0c0]"
          title="Précédent"
          data-testid="explorer-back"
        >
          <ArrowLeft size={14} />
        </button>
        <button
          type="button"
          disabled={future.length === 0}
          onClick={() => {
            const next = future[0]
            if (next === undefined) return
            setFuture(future.slice(1))
            setHistory([...history, location])
            navigate(next, false)
          }}
          className="rounded p-1 hover:bg-[#e5f3ff] disabled:text-[#c0c0c0]"
          title="Suivant"
        >
          <ArrowRight size={14} />
        </button>
        <button
          type="button"
          disabled={parentLocation(location) === null}
          onClick={() => {
            const up = parentLocation(location)
            if (up !== null) navigate(up)
          }}
          className="rounded p-1 hover:bg-[#e5f3ff] disabled:text-[#c0c0c0]"
          title="Dossier parent"
          data-testid="explorer-up"
        >
          <ArrowUp size={14} />
        </button>
        <form
          className="flex min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault()
            navigate(address)
          }}
        >
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="h-6 min-w-0 flex-1 border border-[#d9d9d9] px-2 outline-none focus:border-[#0078d7]"
            spellCheck={false}
            data-testid="explorer-address"
          />
        </form>
      </div>
      <div className="flex min-h-0 flex-1">
        {/* Volet de navigation */}
        <nav className="w-48 shrink-0 overflow-y-auto border-r border-[#e5e5e5] py-1">
          <NavItem
            icon={<Computer size={14} className="text-sky-600" />}
            label="Ce PC"
            active={location === THIS_PC}
            onClick={() => navigate(THIS_PC)}
            testId="explorer-nav-thispc"
          />
          <NavItem
            icon={<HardDrive size={14} className="text-slate-500" />}
            label="Disque local (C:)"
            indent
            active={location.toUpperCase().startsWith('C:')}
            onClick={() => navigate('C:\\')}
            testId="explorer-nav-c"
          />
          {drives.map((d) => (
            <NavItem
              key={d.letter}
              icon={<Network size={14} className="text-slate-500" />}
              label={`${driveLabel(d.label, d.path)} (${d.letter}:)`}
              indent
              active={location.toUpperCase().startsWith(`${d.letter}:`)}
              onClick={() => navigate(`${d.letter}:\\`)}
              testId={`explorer-nav-${d.letter}`}
            />
          ))}
        </nav>
        {/* Contenu */}
        <div
          className="min-w-0 flex-1 overflow-y-auto"
          onClick={(e) => e.target === e.currentTarget && setSelected(null)}
        >
          <Content
            view={view}
            device={device}
            drives={drives}
            selected={selected}
            onSelect={setSelected}
            onOpen={(item) => {
              if (item.kind === 'folder') navigate(joinLocation(location, item.name))
              else if (local) properties(item)
            }}
            onOpenDrive={(letter) => navigate(letter === 'C' ? 'C:\\' : `${letter}:\\`)}
            onDisconnect={(letter) => {
              const r = unmapDrive(lab, device.id, letter, token.account)
              if (r.ok) useLabStore.getState().run(() => ({ ok: true, state: r.state, value: undefined }))
            }}
          />
        </div>
      </div>
      <div
        className="flex h-6 shrink-0 items-center border-t border-[#e5e5e5] px-3 text-[11px] text-[#555]"
        data-testid="explorer-status"
      >
        {view.kind === 'folder'
          ? `${view.items.length} élément(s)`
          : view.kind === 'thispc'
            ? `${drives.length + 1} élément(s)`
            : ''}
      </div>

      {dialog?.kind === 'message' && (
        <MessageBox
          title={dialog.title}
          message={dialog.message}
          icon={dialog.icon}
          testId="explorer-message"
          buttons={[
            { label: 'OK', primary: true, onClick: () => setDialog(null), testId: 'explorer-message-ok' }
          ]}
        />
      )}
      {dialog?.kind === 'delete' && (
        <MessageBox
          title={dialog.item.kind === 'folder' ? 'Supprimer le dossier' : 'Supprimer le fichier'}
          icon="warning"
          message={`Voulez-vous vraiment supprimer définitivement ${dialog.item.kind === 'folder' ? 'ce dossier' : 'ce fichier'} ?\n\n${dialog.item.name}`}
          testId="explorer-confirm"
          buttons={[
            {
              label: 'Oui',
              primary: true,
              onClick: () => remove(dialog.item),
              testId: 'explorer-confirm-yes'
            },
            { label: 'Non', onClick: () => setDialog(null), testId: 'explorer-confirm-no' }
          ]}
        />
      )}
      {dialog?.kind === 'name' && (
        <NameDialog
          initial={dialog.what === 'folder' ? 'Nouveau dossier' : 'Nouveau document texte.txt'}
          title={dialog.what === 'folder' ? 'Nouveau dossier' : 'Nouveau document texte'}
          onCancel={() => setDialog(null)}
          onSubmit={(name) => create(dialog.what, name)}
        />
      )}
      {dialog?.kind === 'map' && (
        <MapDriveDialog
          used={drives.map((d) => d.letter)}
          onCancel={() => setDialog(null)}
          onSubmit={(letter, path, persistent) => {
            const op = mapDrive(lab, device.id, letter, path, token, { persistent })
            if (!op.ok) {
              setDialog({
                kind: 'message',
                title: 'Connecter un lecteur réseau',
                message:
                  op.code === 53 || op.code === 67
                    ? `Le dossier spécifié n’est pas valide.\n\n${op.message}`
                    : op.message,
                icon: 'error'
              })
              return
            }
            setDialog(null)
            runNetworkOperation(op.trace, () => {
              useLabStore.getState().run(() => ({ ok: true, state: op.state, value: undefined }))
              navigate(`${letter}:\\`)
            })
          }}
        />
      )}
    </div>
  )
}

function driveLabel(label: string, path: string): string {
  const unc = parseUnc(path)
  return `${label || unc?.share || path} (\\\\${unc?.server ?? ''})`
}

function NavItem({
  icon,
  label,
  onClick,
  active,
  indent,
  testId
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  active?: boolean
  indent?: boolean
  testId: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-1.5 truncate py-1 pr-2 text-left hover:bg-[#e5f3ff] ${indent ? 'pl-6' : 'pl-2'} ${active ? 'bg-[#cce8ff]' : ''}`}
      data-testid={testId}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  )
}

function Content({
  view,
  device,
  drives,
  selected,
  onSelect,
  onOpen,
  onOpenDrive,
  onDisconnect
}: {
  view: ExplorerView
  device: HostDevice
  drives: ReturnType<typeof sessionDrives>
  selected: string | null
  onSelect: (id: string | null) => void
  onOpen: (item: FsNode) => void
  onOpenDrive: (letter: string) => void
  onDisconnect: (letter: string) => void
}) {
  if (view.kind === 'thispc')
    return (
      <div className="p-3" data-testid="thispc">
        <h3 className="mb-1 text-[13px] text-[#1e3287]">Périphériques et lecteurs (1)</h3>
        <div className="mb-4 flex flex-wrap gap-2">
          <DriveTile
            icon={<HardDrive size={30} strokeWidth={1.3} className="text-slate-500" />}
            label="Disque local (C:)"
            detail={device.kind === 'server' ? '41,6 Go libres sur 59,3 Go' : '33,9 Go libres sur 49,4 Go'}
            onOpen={() => onOpenDrive('C')}
            testId="drive-C"
          />
        </div>
        <h3 className="mb-1 text-[13px] text-[#1e3287]">Emplacements réseau ({drives.length})</h3>
        {drives.length === 0 ? (
          <p className="text-[#6d6d6d]">Aucun lecteur réseau connecté.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {drives.map((d) => (
              <DriveTile
                key={d.letter}
                icon={<Network size={30} strokeWidth={1.3} className="text-slate-500" />}
                label={`${driveLabel(d.label, d.path)} (${d.letter}:)`}
                detail={`${d.path}${d.source === 'gpo' ? ' — stratégie de groupe' : ''}`}
                onOpen={() => onOpenDrive(d.letter)}
                {...(d.source === 'manual' ? { onDisconnect: () => onDisconnect(d.letter) } : {})}
                testId={`drive-${d.letter}`}
              />
            ))}
          </div>
        )}
      </div>
    )
  if (view.kind === 'client-volume')
    return (
      <p className="p-6 text-[#6d6d6d]" data-testid="explorer-client-volume">
        Le contenu du disque local n’est pas simulé sur les postes clients : ouvrez un partage réseau
        (\\serveur\partage) ou un lecteur réseau.
      </p>
    )
  if (view.kind === 'error') return <p className="p-6 text-[#6d6d6d]">{view.message}</p>
  if (view.items.length === 0) return <p className="p-6 text-center text-[#6d6d6d]">Ce dossier est vide.</p>
  return (
    <table className="w-full" data-testid="explorer-items">
      <thead className="sticky top-0 bg-white text-left text-[#4c607a]">
        <tr>
          {['Nom', 'Modifié le', 'Type', 'Taille'].map((c) => (
            <th key={c} className="border-b border-[#e5e5e5] px-3 py-1 font-normal">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {view.items.map((item) => (
          <tr
            key={item.id}
            onClick={() => onSelect(item.id)}
            onDoubleClick={() => onOpen(item)}
            className={`cursor-default ${selected === item.id ? 'bg-[#cce8ff]' : 'hover:bg-[#e5f3ff]'}`}
            data-testid={`explorer-item-${item.name}`}
          >
            <td className="flex items-center gap-1.5 px-3 py-0.5">
              {item.kind === 'folder' ? (
                <Folder size={15} className="fill-[#ffd76e] text-[#dcb045]" />
              ) : (
                <FileText size={15} className="text-slate-500" />
              )}
              {item.name}
            </td>
            <td className="px-3 py-0.5 text-[#6d6d6d]">{formatShortDate(item.modifiedAt).slice(0, 16)}</td>
            <td className="px-3 py-0.5 text-[#6d6d6d]">{fileType(item.name, item.kind)}</td>
            <td className="px-3 py-0.5 text-right text-[#6d6d6d]">
              {item.kind === 'file' ? displaySize(item.size) : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function DriveTile({
  icon,
  label,
  detail,
  onOpen,
  onDisconnect,
  testId
}: {
  icon: ReactNode
  label: string
  detail: string
  onOpen: () => void
  onDisconnect?: () => void
  testId: string
}) {
  return (
    <div
      className="group flex w-72 items-center gap-3 rounded-sm p-2 hover:bg-[#e5f3ff]"
      onDoubleClick={onOpen}
      data-testid={testId}
    >
      {icon}
      <div className="min-w-0 flex-1">
        <div className="truncate">{label}</div>
        <div className="truncate text-[11px] text-[#6d6d6d]">{detail}</div>
      </div>
      {onDisconnect && (
        <button
          type="button"
          onClick={onDisconnect}
          className="invisible rounded p-1 text-[#555] group-hover:visible hover:bg-white"
          title="Déconnecter"
          data-testid={`${testId}-disconnect`}
        >
          <Unplug size={13} />
        </button>
      )}
    </div>
  )
}

function NameDialog({
  initial,
  title,
  onSubmit,
  onCancel
}: {
  initial: string
  title: string
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial)
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/10">
      <form
        className="flex w-[360px] flex-col border border-[#8a8a8a] bg-[#f0f0f0] shadow-xl"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit(name)
        }}
        data-testid="explorer-name-dialog"
      >
        <div className="flex h-7 items-center bg-white px-2 text-xs">{title}</div>
        <DialogBody>
          <label className="mb-1 block">Nom :</label>
          <WinInput
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            data-testid="explorer-name"
          />
        </DialogBody>
        <DialogFooter>
          <WinButton primary type="submit" data-testid="explorer-name-ok">
            OK
          </WinButton>
          <WinButton onClick={onCancel}>Annuler</WinButton>
        </DialogFooter>
      </form>
    </div>
  )
}

function MapDriveDialog({
  used,
  onSubmit,
  onCancel
}: {
  used: string[]
  onSubmit: (letter: string, path: string, persistent: boolean) => void
  onCancel: () => void
}) {
  const free = LETTERS.filter((l) => !used.includes(l))
  const [letter, setLetter] = useState(free[0] ?? 'Z')
  const [path, setPath] = useState('')
  const [persistent, setPersistent] = useState(true)
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/10">
      <form
        className="flex w-[480px] flex-col border border-[#8a8a8a] bg-[#f0f0f0] shadow-xl"
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit(letter, path, persistent)
        }}
        data-testid="map-dialog"
      >
        <div className="flex h-7 items-center bg-white px-2 text-xs">Connecter un lecteur réseau</div>
        <DialogBody className="flex flex-col gap-2">
          <p className="text-sm text-[#1e3287]">Quel dossier réseau voulez-vous connecter ?</p>
          <p>
            Spécifiez la lettre désignant le lecteur et le dossier auxquels vous souhaitez vous connecter :
          </p>
          <label className="flex items-center gap-2">
            <span className="w-16">Lecteur :</span>
            <select
              value={letter}
              onChange={(e) => setLetter(e.target.value)}
              className={`${winInputClass} !w-20`}
              data-testid="map-letter"
            >
              {free.map((l) => (
                <option key={l} value={l}>
                  {l}:
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="w-16">Dossier :</span>
            <WinInput
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="\\serveur\partage"
              data-testid="map-path"
            />
          </label>
          <p className="pl-[72px] text-[11px] text-[#555]">Exemple : \\serveur\partage</p>
          <label className="flex items-center gap-1.5 pl-[72px]">
            <input
              type="checkbox"
              checked={persistent}
              onChange={(e) => setPersistent(e.target.checked)}
              data-testid="map-reconnect"
            />
            Se reconnecter lors de la connexion
          </label>
        </DialogBody>
        <DialogFooter>
          <WinButton primary type="submit" data-testid="map-ok">
            Terminer
          </WinButton>
          <WinButton onClick={onCancel}>Annuler</WinButton>
        </DialogFooter>
      </form>
    </div>
  )
}
