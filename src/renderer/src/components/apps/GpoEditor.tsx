/**
 * Éditeur de gestion des stratégies de groupe : arborescence Configuration ordinateur /
 * utilisateur, liste des paramètres simulés, boîtes de dialogue de paramètre (Non configuré,
 * Activé, Désactivé, options, aide) et préférences de mappage de lecteurs.
 */
import { useState, type ReactNode } from 'react'
import { Computer, Folder, FolderCog, HardDrive, ScrollText, UserRound, type LucideIcon } from 'lucide-react'
import {
  DRIVE_ACTION_LABELS,
  EDITOR_TREE,
  firewallRuleSummary,
  POLICY_SETTINGS,
  POLICY_STATE_LABELS,
  settingValue,
  templateState,
  WALLPAPER_STYLE_LABELS,
  WALLPAPER_STYLES,
  type Domain,
  type DriveMap,
  type FirewallRule,
  type Gpo,
  type GpoSettingsPatch,
  type HostDevice,
  type PolicyNode,
  type PolicySettingInfo,
  type PolicyState,
  type WallpaperStyle,
  command
} from '@engine/index'
import { requireAdmin } from '../../lib/directory'
import { runCommandOk } from '../../lib/run'
import { WALLPAPER_DIR } from '../../lib/wallpapers'
import { FormDialog } from '../common/FormDialog'
import { useLabStore } from '../../store/lab'
import {
  DialogBody,
  DialogFooter,
  GroupBox,
  WinButton,
  WinInput,
  winInputClass
} from '../desktop/shell/classic'
import { Mmc, MmcAction, MmcTable, type MmcNode } from '../mmc/Mmc'

const NODE_ICONS: Record<string, LucideIcon> = {
  computer: Computer,
  user: UserRound,
  'u-drivemaps': HardDrive,
  'c-password': ScrollText,
  'c-secopts': ScrollText
}

function toMmc(nodes: PolicyNode[]): MmcNode[] {
  return nodes.map((n) => ({
    id: n.id,
    label: n.label,
    icon: NODE_ICONS[n.id] ?? (n.id.includes('admx') ? FolderCog : Folder),
    iconClass: n.id === 'computer' || n.id === 'user' ? 'text-sky-600' : 'text-amber-600',
    ...(n.children ? { children: toMmc(n.children) } : {})
  }))
}

function findNode(nodes: PolicyNode[], id: string): PolicyNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n
    const child = n.children ? findNode(n.children, id) : undefined
    if (child) return child
  }
  return undefined
}

/** État affiché dans la liste des paramètres. */
function stateLabel(info: PolicySettingInfo, gpo: Gpo): string {
  const state = templateState(info.key, gpo.computer, gpo.user)
  if (state) return POLICY_STATE_LABELS[state]
  return settingValue(info.key, gpo.computer, gpo.user) ?? 'Non défini'
}

type Editing =
  | { kind: 'setting'; info: PolicySettingInfo }
  | { kind: 'drive'; index: number | null }
  | { kind: 'fwrule' }
  | null

export function GpoEditor({ device, gpoId }: { device: HostDevice; gpoId: string | undefined }) {
  const lab = useLabStore((s) => s.lab)
  const domain: Domain | undefined = device.host.domain ? lab.domains[device.host.domain] : undefined
  const gpo = domain?.gpos.find((g) => g.id === gpoId)
  const [node, setNode] = useState('root')
  const [row, setRow] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  if (!domain || !gpo)
    return <div className="p-6 text-sm text-slate-500">L’objet de stratégie de groupe est introuvable.</div>

  const dc = lab.devices[domain.controllers[0] ?? '']
  const nodes: MmcNode[] = [
    {
      id: 'root',
      label: `Stratégie ${gpo.name} [${dc ? `${dc.name}.${domain.name}` : domain.name}]`,
      icon: ScrollText,
      iconClass: 'text-amber-600',
      children: toMmc(EDITOR_TREE)
    }
  ]
  const save = (patch: GpoSettingsPatch): boolean =>
    requireAdmin(device) && runCommandOk(command('gpo.updateSettings', domain.name, gpo.id, patch))

  const settings = POLICY_SETTINGS.filter((s) => s.node === node)
  const current = findNode(EDITOR_TREE, node)
  let content: ReactNode
  let actions: ReactNode = null
  if (settings.length > 0) {
    const info = settings.find((s) => s.key === row)
    actions = info ? (
      <MmcAction onClick={() => setEditing({ kind: 'setting', info })} testId="gpme-edit">
        Modifier le paramètre de stratégie
      </MmcAction>
    ) : null
    content = (
      <MmcTable
        testId="gpme-settings"
        columns={
          info?.kind === 'template' || settings[0]?.kind === 'template'
            ? ['Paramètre', 'État']
            : ['Stratégie', 'Paramètre de stratégie']
        }
        empty=""
        rows={settings.map((s) => [
          <button
            key="n"
            type="button"
            className={`text-left ${row === s.key ? 'font-semibold text-sky-700' : ''}`}
            onClick={() => setRow(s.key)}
            onDoubleClick={() => setEditing({ kind: 'setting', info: s })}
            data-testid={`gpme-setting-${s.key}`}
          >
            {s.label}
          </button>,
          <span key="v" data-testid={`gpme-state-${s.key}`}>
            {stateLabel(s, gpo)}
          </span>
        ])}
      />
    )
  } else if (node === 'u-drivemaps') {
    const index = row === null ? -1 : Number(row)
    actions = (
      <>
        <MmcAction onClick={() => setEditing({ kind: 'drive', index: null })} testId="gpme-new-drive">
          Nouveau › Lecteur mappé
        </MmcAction>
        {index >= 0 && (
          <>
            <MmcAction onClick={() => setEditing({ kind: 'drive', index })}>Propriétés</MmcAction>
            <MmcAction
              danger
              onClick={() => {
                if (save({ user: { driveMaps: gpo.user.driveMaps.filter((_, i) => i !== index) } }))
                  setRow(null)
              }}
              testId="gpme-delete-drive"
            >
              Supprimer
            </MmcAction>
          </>
        )}
      </>
    )
    content = (
      <MmcTable
        testId="gpme-drives"
        columns={['Nom', 'Ordre', 'Action', 'Chemin']}
        empty="Il n’y a aucun élément à afficher dans cet affichage. Action › Nouveau › Lecteur mappé."
        rows={gpo.user.driveMaps.map((d, i) => [
          <button
            key="n"
            type="button"
            className={`flex items-center gap-1 text-left ${row === String(i) ? 'font-semibold text-sky-700' : ''}`}
            onClick={() => setRow(String(i))}
            onDoubleClick={() => setEditing({ kind: 'drive', index: i })}
            data-testid={`gpme-drive-${d.letter}`}
          >
            <HardDrive size={13} className="text-slate-500" /> {d.letter}:
          </button>,
          i + 1,
          DRIVE_ACTION_LABELS[d.action],
          d.path
        ])}
      />
    )
  } else if (node === 'c-fw-inbound') {
    const index = row === null ? -1 : Number(row)
    actions = (
      <>
        <MmcAction onClick={() => setEditing({ kind: 'fwrule' })} testId="gpme-new-fwrule">
          Nouvelle règle…
        </MmcAction>
        {index >= 0 && (
          <MmcAction
            danger
            onClick={() => {
              if (
                save({
                  computer: { firewallRules: gpo.computer.firewallRules.filter((_, i) => i !== index) }
                })
              )
                setRow(null)
            }}
          >
            Supprimer
          </MmcAction>
        )}
      </>
    )
    content = (
      <MmcTable
        testId="gpme-fwrules"
        columns={['Nom', 'Règle']}
        empty="Il n’y a aucun élément à afficher dans cet affichage. Action › Nouvelle règle."
        rows={gpo.computer.firewallRules.map((r, i) => [
          <button
            key="n"
            type="button"
            className={`text-left ${row === String(i) ? 'font-semibold text-sky-700' : ''}`}
            onClick={() => setRow(String(i))}
          >
            {r.displayName}
          </button>,
          firewallRuleSummary(r)
        ])}
      />
    )
  } else {
    // Dossier : liste de ses éléments enfants
    const children = node === 'root' ? EDITOR_TREE : (current?.children ?? [])
    content =
      children.length === 0 ? (
        <div className="p-6 text-xs text-slate-500">
          Aucun paramètre de cette catégorie n’est simulé. Les paramètres disponibles se trouvent dans «
          Stratégie de mot de passe », « Options de sécurité », les modèles d’administration de la
          configuration utilisateur et les mappages de lecteurs.
        </div>
      ) : (
        <MmcTable
          columns={['Nom']}
          empty=""
          rows={children.map((c) => [
            <button
              key="n"
              type="button"
              className="flex items-center gap-1.5 text-left"
              onDoubleClick={() => {
                setNode(c.id)
                setRow(null)
              }}
            >
              <Folder size={13} className="text-amber-600" /> {c.label}
            </button>
          ])}
        />
      )
  }

  return (
    <div className="relative h-full">
      <Mmc
        nodes={nodes}
        selected={node}
        onSelect={(id) => {
          setNode(id)
          setRow(null)
        }}
        actions={actions ?? undefined}
        testId="gpme"
        treeWidth={300}
      >
        {content}
      </Mmc>
      {editing?.kind === 'setting' && (
        <SettingDialog info={editing.info} gpo={gpo} onSave={save} onClose={() => setEditing(null)} />
      )}
      {editing?.kind === 'fwrule' && (
        <FormDialog
          title="Assistant Nouvelle règle de trafic entrant"
          fields={[
            { key: 'name', label: 'Nom', placeholder: 'Bloquer le ping' },
            {
              key: 'action',
              label: 'Action',
              type: 'select',
              options: [
                { value: 'Allow', label: 'Autoriser la connexion' },
                { value: 'Block', label: 'Bloquer la connexion' }
              ]
            },
            {
              key: 'protocol',
              label: 'Protocole',
              type: 'select',
              options: [
                { value: 'TCP', label: 'TCP' },
                { value: 'UDP', label: 'UDP' },
                { value: 'ICMPv4', label: 'ICMPv4' },
                { value: 'Any', label: 'Tout' }
              ]
            },
            { key: 'ports', label: 'Ports locaux (vide : tous)', placeholder: '3389' }
          ]}
          onSubmit={(v) => {
            const displayName = String(v['name']).trim()
            const protocol = String(v['protocol']) as FirewallRule['protocol']
            const ports = String(v['ports'])
              .split(/[,;\s]+/)
              .filter(Boolean)
              .map(Number)
            if (!displayName || ports.some((p) => !Number.isInteger(p) || p < 1 || p > 65535)) return false
            const rule: FirewallRule = {
              id: `GPO-${gpo.computer.firewallRules.length + 1}-${displayName}`,
              displayName,
              group: '',
              direction: 'Inbound',
              action: v['action'] === 'Block' ? 'Block' : 'Allow',
              enabled: true,
              protocol,
              localPorts: protocol === 'TCP' || protocol === 'UDP' ? ports : [],
              remoteAddresses: [],
              profiles: []
            }
            return save({ computer: { firewallRules: [...gpo.computer.firewallRules, rule] } })
          }}
          onClose={() => setEditing(null)}
          testId="gpme-fwrule-dialog"
        />
      )}
      {editing?.kind === 'drive' && (
        <DriveDialog
          map={editing.index === null ? null : (gpo.user.driveMaps[editing.index] ?? null)}
          onClose={() => setEditing(null)}
          onSave={(map) => {
            const list = [...gpo.user.driveMaps]
            if (editing.index === null) list.push(map)
            else list[editing.index] = map
            return save({ user: { driveMaps: list } })
          }}
        />
      )}
    </div>
  )
}

/** Fenêtre de paramètre : état, options, aide ; OK / Annuler / Appliquer. */
function SettingDialog({
  info,
  gpo,
  onSave,
  onClose
}: {
  info: PolicySettingInfo
  gpo: Gpo
  onSave: (patch: GpoSettingsPatch) => boolean
  onClose: () => void
}) {
  const c = gpo.computer
  const u = gpo.user
  const initialState: PolicyState = templateState(info.key, c, u) ?? 'NotConfigured'
  // Paramètres de sécurité (« Définir ce paramètre de stratégie ») : valeur actuelle de la GPO
  const numberKey =
    info.key === 'minPasswordLength' ||
    info.key === 'lockoutThreshold' ||
    info.key === 'lockoutDuration' ||
    info.key === 'lockoutReset'
      ? info.key
      : null
  const auditKey = info.key === 'auditLogon' || info.key === 'auditAccountManagement' ? info.key : null
  const initialDefined =
    numberKey !== null
      ? c[numberKey] !== null
      : auditKey !== null
        ? c[auditKey] !== null
        : info.key === 'passwordComplexity'
          ? c.passwordComplexity !== null
          : info.key === 'logonMessageTitle'
            ? c.logonMessageTitle !== null
            : info.key === 'logonMessageText'
              ? c.logonMessageText !== null
              : false
  const initialAudit = auditKey ? c[auditKey] : null
  const [state, setState] = useState<PolicyState>(initialState)
  const [defined, setDefined] = useState(initialDefined)
  const [path, setPath] = useState(u.wallpaper.path)
  const [style, setStyle] = useState<WallpaperStyle>(u.wallpaper.style)
  const [wuUrl, setWuUrl] = useState(c.wuServer.url)
  const [wuGroup, setWuGroup] = useState(c.wuTargetGroup.group)
  const [length, setLength] = useState(String((numberKey ? c[numberKey] : null) ?? info.number?.initial ?? 0))
  const [auditSuccess, setAuditSuccess] = useState(
    initialAudit === 'Success' || initialAudit === 'SuccessAndFailure'
  )
  const [auditFailure, setAuditFailure] = useState(
    initialAudit === 'Failure' || initialAudit === 'SuccessAndFailure'
  )
  const [complexity, setComplexity] = useState(c.passwordComplexity ?? true)
  const [text, setText] = useState(
    (info.key === 'logonMessageTitle'
      ? c.logonMessageTitle
      : info.key === 'logonMessageText'
        ? c.logonMessageText
        : '') ?? ''
  )

  const patch = (): GpoSettingsPatch => {
    switch (info.key) {
      case 'wallpaper':
        return { user: { wallpaper: { state, path: state === 'Enabled' ? path : u.wallpaper.path, style } } }
      case 'noRun':
      case 'noControlPanel':
      case 'noCmd':
        return { user: { [info.key]: state } }
      case 'autoEnrollment':
        return { computer: { autoEnrollment: state } }
      case 'firewallDomain':
      case 'firewallStandard':
        return { computer: { [info.key]: state } }
      case 'wuServer':
        return { computer: { wuServer: { state, url: state === 'Enabled' ? wuUrl.trim() : c.wuServer.url } } }
      case 'wuTargetGroup':
        return {
          computer: {
            wuTargetGroup: { state, group: state === 'Enabled' ? wuGroup.trim() : c.wuTargetGroup.group }
          }
        }
      case 'minPasswordLength':
      case 'lockoutThreshold':
      case 'lockoutDuration':
      case 'lockoutReset':
        return { computer: { [info.key]: defined ? Number(length) : null } }
      case 'auditLogon':
      case 'auditAccountManagement':
        return {
          computer: {
            [info.key]: defined
              ? auditSuccess && auditFailure
                ? 'SuccessAndFailure'
                : auditSuccess
                  ? 'Success'
                  : auditFailure
                    ? 'Failure'
                    : 'None'
              : null
          }
        }
      case 'passwordComplexity':
        return { computer: { passwordComplexity: defined ? complexity : null } }
      case 'logonMessageTitle':
      case 'logonMessageText':
        return { computer: { [info.key]: defined ? text : null } }
    }
  }
  const apply = () => onSave(patch())

  const radio = (value: PolicyState, testId: string) => (
    <label className="flex items-center gap-1.5">
      <input type="radio" checked={state === value} onChange={() => setState(value)} data-testid={testId} />
      {POLICY_STATE_LABELS[value]}
    </label>
  )

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/10">
      <div
        className="flex max-h-[95%] w-[620px] max-w-[96%] flex-col border border-[#8a8a8a] bg-[#f0f0f0] shadow-xl"
        data-testid="policy-dialog"
      >
        <div className="flex h-7 shrink-0 items-center bg-white px-2 text-xs text-black">{info.label}</div>
        <DialogBody>
          <p className="mb-2 font-semibold">{info.label}</p>
          {info.kind === 'template' ? (
            <div className="grid grid-cols-[180px_1fr] gap-3">
              <div className="flex flex-col gap-1.5">
                {radio('NotConfigured', 'policy-notconfigured')}
                {radio('Enabled', 'policy-enabled')}
                {radio('Disabled', 'policy-disabled')}
              </div>
              <GroupBox label="Aide :">
                <p className="leading-relaxed whitespace-pre-line">{info.help}</p>
              </GroupBox>
              {info.key === 'wallpaper' && (
                <GroupBox label="Options :" className="col-span-2">
                  <label className="mb-1 block">Nom du papier peint :</label>
                  <WinInput
                    value={path}
                    disabled={state !== 'Enabled'}
                    onChange={(e) => setPath(e.target.value)}
                    placeholder="\\serveur\partage\image.jpg"
                    data-testid="policy-wallpaper-path"
                  />
                  <p className="mt-1 text-[11px] text-[#555]">
                    Exemple : {WALLPAPER_DIR}\aurore.jpg (aussi : ocean.jpg, foret.jpg, desert.jpg, nuit.jpg)
                  </p>
                  <label className="mt-2 mb-1 block">Style du papier peint :</label>
                  <select
                    value={style}
                    disabled={state !== 'Enabled'}
                    onChange={(e) => setStyle(e.target.value as WallpaperStyle)}
                    className={`${winInputClass} w-40`}
                    data-testid="policy-wallpaper-style"
                  >
                    {WALLPAPER_STYLES.map((s) => (
                      <option key={s} value={s}>
                        {WALLPAPER_STYLE_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </GroupBox>
              )}
              {info.key === 'wuServer' && (
                <GroupBox label="Options :" className="col-span-2">
                  <label className="mb-1 block">
                    Configurer le service intranet de mise à jour pour la détection des mises à jour :
                  </label>
                  <WinInput
                    value={wuUrl}
                    disabled={state !== 'Enabled'}
                    onChange={(e) => setWuUrl(e.target.value)}
                    placeholder="http://srv1.lab.local:8530"
                    data-testid="policy-wu-url"
                  />
                </GroupBox>
              )}
              {info.key === 'wuTargetGroup' && (
                <GroupBox label="Options :" className="col-span-2">
                  <label className="mb-1 block">Nom du groupe cible pour cet ordinateur :</label>
                  <WinInput
                    value={wuGroup}
                    disabled={state !== 'Enabled'}
                    onChange={(e) => setWuGroup(e.target.value)}
                    data-testid="policy-wu-group"
                  />
                </GroupBox>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={defined}
                  onChange={(e) => setDefined(e.target.checked)}
                  data-testid="policy-define"
                />
                Définir ce paramètre de stratégie
              </label>
              {info.kind === 'number' && info.number && (
                <label className="flex flex-wrap items-center gap-2">
                  {info.number.before}
                  <WinInput
                    type="number"
                    min={info.number.min}
                    max={info.number.max}
                    value={length}
                    disabled={!defined}
                    onChange={(e) => setLength(e.target.value)}
                    className="!w-20"
                    data-testid="policy-number"
                  />
                  {info.number.after}
                </label>
              )}
              {info.kind === 'audit' && (
                <div className="flex flex-col gap-1.5">
                  <span>Auditer ces tentatives :</span>
                  <label className="flex items-center gap-1.5 pl-4">
                    <input
                      type="checkbox"
                      disabled={!defined}
                      checked={auditSuccess}
                      onChange={(e) => setAuditSuccess(e.target.checked)}
                      data-testid="policy-audit-success"
                    />
                    Succès
                  </label>
                  <label className="flex items-center gap-1.5 pl-4">
                    <input
                      type="checkbox"
                      disabled={!defined}
                      checked={auditFailure}
                      onChange={(e) => setAuditFailure(e.target.checked)}
                      data-testid="policy-audit-failure"
                    />
                    Échec
                  </label>
                </div>
              )}
              {info.kind === 'boolean' && (
                <div className="flex flex-col gap-1.5">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      disabled={!defined}
                      checked={complexity}
                      onChange={() => setComplexity(true)}
                      data-testid="policy-bool-enabled"
                    />
                    Activé
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      disabled={!defined}
                      checked={!complexity}
                      onChange={() => setComplexity(false)}
                      data-testid="policy-bool-disabled"
                    />
                    Désactivé
                  </label>
                </div>
              )}
              {info.kind === 'text' && (
                <WinInput
                  value={text}
                  disabled={!defined}
                  onChange={(e) => setText(e.target.value)}
                  data-testid="policy-text"
                />
              )}
              {info.kind === 'multiline' && (
                <textarea
                  value={text}
                  disabled={!defined}
                  onChange={(e) => setText(e.target.value)}
                  rows={5}
                  className="w-full resize-none border border-[#7a7a7a] bg-white p-1.5 text-xs text-black outline-none focus:border-[#0078d7] disabled:bg-[#f0f0f0]"
                  data-testid="policy-text"
                />
              )}
              <GroupBox label="Explication">
                <p className="leading-relaxed">{info.help}</p>
              </GroupBox>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <WinButton
            primary
            onClick={() => {
              if (apply()) onClose()
            }}
            data-testid="policy-ok"
          >
            OK
          </WinButton>
          <WinButton onClick={onClose} data-testid="policy-cancel">
            Annuler
          </WinButton>
          <WinButton onClick={apply} data-testid="policy-apply">
            Appliquer
          </WinButton>
        </DialogFooter>
      </div>
    </div>
  )
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((l) => l !== 'C')

/** Propriétés d'un lecteur mappé (préférence). */
function DriveDialog({
  map,
  onSave,
  onClose
}: {
  map: DriveMap | null
  onSave: (map: DriveMap) => boolean
  onClose: () => void
}) {
  const [action, setAction] = useState<DriveMap['action']>(map?.action ?? 'Update')
  const [path, setPath] = useState(map?.path ?? '')
  const [label, setLabel] = useState(map?.label ?? '')
  const [letter, setLetter] = useState(map?.letter ?? 'Z')
  const [reconnect, setReconnect] = useState(map?.reconnect ?? true)
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/10">
      <div
        className="flex w-[440px] flex-col border border-[#8a8a8a] bg-[#f0f0f0] shadow-xl"
        data-testid="drive-dialog"
      >
        <div className="flex h-7 items-center bg-white px-2 text-xs text-black">
          Propriétés de Nouveau lecteur
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (onSave({ action, path, label, letter, reconnect })) onClose()
          }}
        >
          <DialogBody className="flex flex-col gap-2">
            <label className="flex items-center justify-between gap-2">
              Action :
              <select
                value={action}
                onChange={(e) => setAction(e.target.value as DriveMap['action'])}
                className={`${winInputClass} !w-56`}
                data-testid="drive-action"
              >
                {(['Create', 'Replace', 'Update', 'Delete'] as const).map((a) => (
                  <option key={a} value={a}>
                    {DRIVE_ACTION_LABELS[a]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Emplacement :
              <WinInput
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="\\serveur\partage"
                data-testid="drive-path"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={reconnect} onChange={(e) => setReconnect(e.target.checked)} />
              Reconnecter
            </label>
            <label className="flex flex-col gap-1">
              Nom :
              <WinInput value={label} onChange={(e) => setLabel(e.target.value)} data-testid="drive-label" />
            </label>
            <label className="flex items-center gap-2">
              Lettre de lecteur — Utiliser :
              <select
                value={letter}
                onChange={(e) => setLetter(e.target.value)}
                className={`${winInputClass} !w-16`}
                data-testid="drive-letter"
              >
                {LETTERS.map((l) => (
                  <option key={l} value={l}>
                    {l}:
                  </option>
                ))}
              </select>
            </label>
          </DialogBody>
          <DialogFooter>
            <WinButton primary type="submit" data-testid="drive-ok">
              OK
            </WinButton>
            <WinButton onClick={onClose}>Annuler</WinButton>
          </DialogFooter>
        </form>
      </div>
    </div>
  )
}
