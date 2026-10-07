/**
 * Partages SMB depuis un poste Linux : mount -t cifs (compte unique pour tout le montage, comme
 * mount.cifs), umount, smbclient -L / -c, et commandes de fichiers sur les montages (ls, touch,
 * mkdir, cat) soumises aux autorisations du partage et NTFS du compte. Messages d'origine des
 * outils (util-linux, mount.cifs, smbclient, coreutils).
 */
import { transact, type EngineResult } from '../../core/result'
import { LAB_EPOCH_MS } from '../../core/clock'
import type { CifsMount, Domain, HostDevice, LabState, ServerDevice } from '../../model/schema'
import { effectiveIpv4 } from '../../net/addressing'
import { ctimeDate, homeDir, isLocalDir, resolvePath } from '../../shell/bash/interpreter'
import { CommandFailure, type ExecContext } from '../../shell/context'
import type { ToolDef } from '../../shell/tools/types'
import { isLockedOut } from '../adds/lockout'
import { resolvConfLines } from '../dns/bash'
import { domainToken, type AccessToken } from './acl'
import { adminShares, createItem } from './actions'
import { openUnc, type UncTarget } from './smb'

/** //srv1/Compta/Budget → \\srv1\Compta\Budget */
const toUnc = (source: string) => source.replace(/\//g, '\\')

/** Domaine d'un compte : DOM\user, user@dom, option domain=, domaine du poste ou du serveur. */
function domainFor(state: LabState, host: HostDevice, account: string, hint?: string): Domain | undefined {
  const domains = Object.values(state.domains)
  const match = (name: string) =>
    domains.find((d) => d.netbios.toLowerCase() === name.toLowerCase() || d.name === name.toLowerCase())
  if (account.includes('\\')) return match(account.split('\\')[0] ?? '')
  if (account.includes('@')) return match(account.split('@')[1] ?? '')
  if (hint) return match(hint)
  return (host.host.domain ? state.domains[host.host.domain] : undefined) ?? domains[0]
}

const samOf = (account: string) =>
  account.includes('\\') ? (account.split('\\')[1] ?? '') : (account.split('@')[0] ?? '')

/** Authentification d'un compte du domaine ; jeton du compte, ou null si refusée. */
export function authenticate(
  state: LabState,
  host: HostDevice,
  account: string,
  password: string,
  domainHint?: string
): { domain: Domain; sam: string; token: AccessToken } | null {
  const domain = domainFor(state, host, account, domainHint)
  if (!domain) return null
  const sam = samOf(account)
  const user = domain.users.find((u) => u.sam.toLowerCase() === sam.toLowerCase())
  if (!user || !user.enabled || user.password !== password || isLockedOut(domain, user, state.clock))
    return null
  const token = domainToken(domain, user.sam)
  return token ? { domain, sam: user.sam, token } : null
}

/** Montage CIFS enregistré sur le poste. */
export function addMount(state: LabState, deviceId: string, mount: CifsMount): EngineResult {
  return transact(state, (draft) => {
    const d = draft.devices[deviceId]
    if (d?.kind === 'client') d.host.mounts.push(mount)
    return undefined
  })
}

export function removeMount(state: LabState, deviceId: string, target: string): EngineResult {
  return transact(state, (draft) => {
    const d = draft.devices[deviceId]
    if (d?.kind === 'client') d.host.mounts = d.host.mounts.filter((m) => m.target !== target)
    return undefined
  })
}

/** Montage contenant le chemin local, et chemin UNC correspondant. */
function mountOf(ctx: ExecContext, path: string): { mount: CifsMount; unc: string } | null {
  const mount = ctx.host.host.mounts.find((m) => path === m.target || path.startsWith(`${m.target}/`))
  if (!mount) return null
  const rest = path.slice(mount.target.length).replace(/^\//, '')
  return { mount, unc: toUnc(rest ? `${mount.source}/${rest}` : mount.source) }
}

/** Ouvre un chemin d'un montage avec le compte du montage. */
function openMounted(ctx: ExecContext, mount: CifsMount, unc: string) {
  const domain = Object.values(ctx.state.domains).find(
    (d) => d.netbios.toUpperCase() === (mount.account.split('\\')[0] ?? '').toUpperCase()
  )
  const token = domain ? domainToken(domain, samOf(mount.account)) : null
  const r = openUnc(ctx.state, ctx.deviceId, unc, token)
  ctx.addTrace(r.trace)
  return r
}

const option = (opts: string, key: string) =>
  opts
    .split(',')
    .find((o) => o.startsWith(`${key}=`))
    ?.slice(key.length + 1)

const SUGGEST = 'Refer to the mount.cifs(8) manual page (e.g. man mount.cifs) and kernel log messages (dmesg)'

const mountTool: ToolDef = {
  name: 'mount',
  synopsis: 'Monte un partage SMB (sudo mount -t cifs //srv1/Partage /mnt/partage -o username=…).',
  run(ctx, args) {
    if (args.length === 0) {
      ctx.writeLines([
        '/dev/sda2 on / type ext4 (rw,relatime)',
        ...ctx.host.host.mounts.map(
          (m) =>
            `${m.source} on ${m.target} type cifs (rw,relatime,vers=3.1.1,cache=strict,username=${samOf(m.account)},domain=${m.account.split('\\')[0] ?? ''})`
        )
      ])
      return
    }
    const type = args[args.indexOf('-t') + 1]
    const opts = args.includes('-o') ? (args[args.indexOf('-o') + 1] ?? '') : ''
    const positional = args.filter(
      (a, i) => !a.startsWith('-') && args[i - 1] !== '-t' && args[i - 1] !== '-o'
    )
    const [source = '', rawTarget = ''] = positional
    if (!rawTarget)
      throw new CommandFailure("mount: bad usage\nTry 'mount --help' for more information.", 'Usage')
    const target = resolvePath(ctx, rawTarget)
    if (!ctx.root)
      throw new CommandFailure(`mount: ${target}: must be superuser to use mount.`, 'PermissionDenied')
    if (type !== 'cifs' || !/^\/\/[^/]+\/[^/]+/.test(source))
      throw new CommandFailure(
        'Seuls les partages SMB sont simulés : mount -t cifs //serveur/partage /mnt/dossier -o username=…',
        'NotSupported'
      )
    if (!/^\/(mnt|media)\/[^/]+$/.test(target))
      throw new CommandFailure(`mount: ${target}: mount point does not exist.`, 'NotFound')
    if (ctx.host.host.mounts.some((m) => m.target === target))
      throw new CommandFailure(`mount error(16): Device or resource busy\n${SUGGEST}`, 'Busy')
    const username = option(opts, 'username') ?? option(opts, 'user')
    if (!username) throw new CommandFailure(`mount error(13): Permission denied\n${SUGGEST}`, 'AccessDenied')
    const password = option(opts, 'password') ?? ctx.ask(`Password for ${username}@${source}: `, true)
    const auth = authenticate(ctx.state, ctx.host, username, password, option(opts, 'domain'))
    const share = source.replace(/\/+$/, '')
    const probe = openUnc(ctx.state, ctx.deviceId, toUnc(share), auth?.token ?? null)
    ctx.addTrace(probe.trace)
    if (!probe.ok && probe.code !== 5)
      throw new CommandFailure(
        probe.code === 67
          ? `mount error(2): No such file or directory\n${SUGGEST}`
          : `mount error(112): Host is down\n${SUGGEST}`,
        'NotFound'
      )
    if (!auth || !probe.ok)
      throw new CommandFailure(`mount error(13): Permission denied\n${SUGGEST}`, 'AccessDenied')
    ctx.apply(
      addMount(ctx.state, ctx.deviceId, {
        source: share,
        target,
        account: `${auth.domain.netbios}\\${auth.sam}`
      })
    )
  }
}

const umountTool: ToolDef = {
  name: 'umount',
  synopsis: 'Démonte un partage (sudo umount /mnt/partage).',
  run(ctx, args) {
    const arg = args.find((a) => !a.startsWith('-'))
    if (!arg) throw new CommandFailure('umount: bad usage', 'Usage')
    const path = arg.startsWith('//') ? arg : resolvePath(ctx, arg)
    const mount = ctx.host.host.mounts.find((m) => m.target === path || m.source === path)
    if (!ctx.root)
      throw new CommandFailure(`umount: ${path}: must be superuser to unmount.`, 'PermissionDenied')
    if (!mount) throw new CommandFailure(`umount: ${path}: not mounted.`, 'NotMounted')
    if (ctx.session.cwd === mount.target || ctx.session.cwd.startsWith(`${mount.target}/`))
      throw new CommandFailure(`umount: ${mount.target}: target is busy.`, 'Busy')
    ctx.apply(removeMount(ctx.state, ctx.deviceId, mount.target))
  }
}

function lsEntries(
  ctx: ExecContext,
  target: UncTarget
): { name: string; folder: boolean; size: number; at: number }[] {
  const server = target.server as ServerDevice
  return server.storage.nodes
    .filter((n) => n.parentId === target.nodeId)
    .map((n) => ({ name: n.name, folder: n.kind === 'folder', size: n.size, at: n.modifiedAt }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter(() => !!ctx)
}

const SYSTEM_DIRS = [
  'bin',
  'boot',
  'dev',
  'etc',
  'home',
  'lib',
  'media',
  'mnt',
  'opt',
  'proc',
  'root',
  'run',
  'sbin',
  'srv',
  'sys',
  'tmp',
  'usr',
  'var'
]

const lsTool: ToolDef = {
  name: 'ls',
  synopsis: 'Liste un dossier (local ou partage monté).',
  run(ctx, args) {
    const arg = args.find((a) => !a.startsWith('-'))
    const path = resolvePath(ctx, arg ?? '.')
    const mounted = mountOf(ctx, path)
    if (mounted) {
      const r = openMounted(ctx, mounted.mount, mounted.unc)
      if (!r.ok)
        throw new CommandFailure(
          r.code === 5
            ? `ls: cannot open directory '${arg ?? path}': Permission denied`
            : `ls: cannot access '${arg ?? path}': No such file or directory`,
          'AccessDenied'
        )
      if (!r.target.perms.has('list'))
        throw new CommandFailure(
          `ls: cannot open directory '${arg ?? path}': Permission denied`,
          'AccessDenied'
        )
      const names = lsEntries(ctx, r.target).map((e) => e.name)
      if (names.length > 0) ctx.write(names.join('  '))
      return
    }
    if (!isLocalDir(ctx, path))
      throw new CommandFailure(`ls: cannot access '${arg ?? path}': No such file or directory`, 'NotFound')
    const names =
      path === '/'
        ? SYSTEM_DIRS
        : path === '/etc'
          ? ['hostname', 'hosts', 'resolv.conf']
          : path === '/home'
            ? [homeDir(ctx).split('/')[2] ?? '']
            : path === '/mnt' || path === '/media'
              ? ctx.host.host.mounts
                  .filter((m) => m.target.startsWith(`${path}/`))
                  .map((m) => m.target.slice(path.length + 1))
              : []
    if (names.length > 0) ctx.write(names.join('  '))
  }
}

/** Création d'un fichier ou d'un dossier sur un montage (droit d'écriture du compte du montage). */
function createOnMount(ctx: ExecContext, tool: string, arg: string, kind: 'file' | 'folder'): void {
  const path = resolvePath(ctx, arg)
  const mounted = mountOf(ctx, path)
  if (!mounted) {
    if (path.startsWith(homeDir(ctx)) || path.startsWith('/tmp')) return // fichiers locaux non conservés
    throw new CommandFailure(
      `${tool}: cannot ${tool === 'touch' ? 'touch' : 'create directory'} '${arg}': Permission denied`,
      'AccessDenied'
    )
  }
  const parentUnc = mounted.unc.split('\\').slice(0, -1).join('\\')
  const name = mounted.unc.split('\\').pop() ?? ''
  const denied = () =>
    new CommandFailure(
      tool === 'touch'
        ? `touch: cannot touch '${arg}': Permission denied`
        : `mkdir: cannot create directory '${arg}': Permission denied`,
      'AccessDenied'
    )
  const existing = openMounted(ctx, mounted.mount, mounted.unc)
  if (existing.ok) {
    if (tool === 'mkdir')
      throw new CommandFailure(`mkdir: cannot create directory '${arg}': File exists`, 'Exists')
    return
  }
  const parent = openMounted(ctx, mounted.mount, parentUnc)
  if (!parent.ok) {
    if (parent.code === 5) throw denied()
    throw new CommandFailure(
      tool === 'touch'
        ? `touch: cannot touch '${arg}': No such file or directory`
        : `mkdir: cannot create directory '${arg}': No such file or directory`,
      'NotFound'
    )
  }
  const domain = Object.values(ctx.state.domains).find(
    (d) => d.netbios.toUpperCase() === (mounted.mount.account.split('\\')[0] ?? '').toUpperCase()
  )
  const token = domain ? domainToken(domain, samOf(mounted.mount.account)) : null
  if (!token) throw denied()
  const r = createItem(
    ctx.state,
    parent.target.server.id,
    `${parent.target.localPath}\\${name}`,
    kind,
    token,
    {
      share: parent.target.share.name
    }
  )
  if (!r.ok) throw denied()
  ctx.state = r.state
}

const touchTool: ToolDef = {
  name: 'touch',
  synopsis: 'Crée un fichier vide (sur un partage monté : droit d’écriture requis).',
  run(ctx, args) {
    const files = args.filter((a) => !a.startsWith('-'))
    if (files.length === 0) throw new CommandFailure('touch: missing file operand', 'Usage')
    for (const f of files) createOnMount(ctx, 'touch', f, 'file')
  }
}

const mkdirTool: ToolDef = {
  name: 'mkdir',
  synopsis: 'Crée un dossier (sur un partage monté : droit d’écriture requis).',
  run(ctx, args) {
    const dirs = args.filter((a) => !a.startsWith('-'))
    if (dirs.length === 0) throw new CommandFailure('mkdir: missing operand', 'Usage')
    for (const d of dirs) createOnMount(ctx, 'mkdir', d, 'folder')
  }
}

const catTool: ToolDef = {
  name: 'cat',
  synopsis: 'Affiche un fichier (/etc/hostname, /etc/hosts, /etc/resolv.conf, fichiers des partages).',
  run(ctx, args) {
    for (const arg of args.filter((a) => !a.startsWith('-'))) {
      const path = resolvePath(ctx, arg)
      if (path === '/etc/hostname') ctx.write(ctx.host.name)
      else if (path === '/etc/hosts')
        ctx.writeLines([
          '127.0.0.1 localhost',
          `127.0.1.1 ${ctx.host.name}`,
          '',
          '# The following lines are desirable for IPv6 capable hosts',
          '::1     ip6-localhost ip6-loopback'
        ])
      else if (path === '/etc/resolv.conf') ctx.writeLines(resolvConfLines(ctx.host.host.domain))
      else {
        const mounted = mountOf(ctx, path)
        const r = mounted ? openMounted(ctx, mounted.mount, mounted.unc) : null
        if (!r || (!r.ok && r.code !== 5))
          throw new CommandFailure(`cat: ${arg}: No such file or directory`, 'NotFound')
        if (!r.ok || !r.target.perms.has('read'))
          throw new CommandFailure(`cat: ${arg}: Permission denied`, 'AccessDenied')
        const node = (r.target.server as ServerDevice).storage.nodes.find((n) => n.id === r.target.nodeId)
        if (node?.kind === 'folder') throw new CommandFailure(`cat: ${arg}: Is a directory`, 'IsDirectory')
        // Contenu des fichiers non simulé : fichier vide
      }
    }
  }
}

/** -U DOM\\user%motdepasse → compte et mot de passe éventuel. */
function smbUser(args: string[]): { account: string; password?: string } | null {
  const i = args.findIndex((a) => a === '-U' || a === '--user')
  const value = i >= 0 ? args[i + 1] : args.find((a) => a.startsWith('--user='))?.slice(7)
  if (!value) return null
  const [account = '', password] = value.split('%')
  return { account, ...(password !== undefined ? { password } : {}) }
}

const smbclientTool: ToolDef = {
  name: 'smbclient',
  synopsis: "Client SMB : smbclient -L //srv1 -U compte, smbclient //srv1/Partage -U compte -c 'ls'.",
  run(ctx, args) {
    const list = args.includes('-L')
    const target = args.find((a, i) => a.startsWith('//') && !['-U', '-c', '-W'].includes(args[i - 1] ?? ''))
    const user = smbUser(args)
    const workgroup = args.includes('-W') ? args[args.indexOf('-W') + 1] : undefined
    if (!target)
      throw new CommandFailure(
        'Usage: smbclient [-L //server] [//server/share] [-U user] [-c command]',
        'Usage'
      )
    const account = user?.account ?? ctx.host.host.session?.user ?? 'etudiant'
    const domain = domainFor(ctx.state, ctx.host, account, workgroup)
    const shown = `${domain?.netbios ?? 'WORKGROUP'}\\${samOf(account) || account}`
    const password = user?.password ?? ctx.ask(`Password for [${shown}]:`, true)
    const auth = authenticate(ctx.state, ctx.host, account, password, workgroup)
    const server = target.replace(/^\/\//, '').split('/')[0] ?? ''
    const ipc = openUnc(ctx.state, ctx.deviceId, `\\\\${server}\\IPC$`, auth?.token ?? null)
    ctx.addTrace(ipc.trace)
    if (!ipc.ok && ipc.code === 53)
      throw new CommandFailure(
        `do_connect: Connection to ${server} failed (Error NT_STATUS_HOST_UNREACHABLE)`,
        'Unreachable'
      )
    if (!auth) throw new CommandFailure('session setup failed: NT_STATUS_LOGON_FAILURE', 'LogonFailure')
    if (list) {
      const host = Object.values(ctx.state.devices).find(
        (d): d is ServerDevice =>
          d.kind === 'server' &&
          (d.name.toLowerCase() === server.toLowerCase() ||
            d.interfaces.some((i) => effectiveIpv4(i)?.address === server))
      )
      const shares = host
        ? [
            ...adminShares(host).map((s) => ({
              name: s.name,
              comment: s.name === 'ADMIN$' ? 'Remote Admin' : 'Default share'
            })),
            ...host.storage.shares.map((s) => ({ name: s.name, comment: s.description ?? '' })),
            { name: 'IPC$', comment: 'Remote IPC' }
          ]
        : []
      ctx.writeLines([
        '',
        '\tSharename       Type      Comment',
        '\t---------       ----      -------',
        ...shares.map(
          (s) => `\t${s.name.padEnd(16)}${(s.name === 'IPC$' ? 'IPC' : 'Disk').padEnd(10)}${s.comment}`
        ),
        'SMB1 disabled -- no workgroup available'
      ])
      return
    }
    const share = target.replace(/\/+$/, '')
    const r = openUnc(ctx.state, ctx.deviceId, toUnc(share), auth.token)
    ctx.addTrace(r.trace)
    if (!r.ok)
      throw new CommandFailure(
        r.code === 67
          ? 'tree connect failed: NT_STATUS_BAD_NETWORK_NAME'
          : 'tree connect failed: NT_STATUS_ACCESS_DENIED',
        'TreeConnect'
      )
    const command = args.includes('-c') ? (args[args.indexOf('-c') + 1] ?? '') : null
    if (command === null)
      throw new CommandFailure(
        "Mode interactif non simulé : utilisez -c 'ls' (ex. smbclient //srv1/Partage -U compte -c 'ls').",
        'NotSupported'
      )
    if (command.trim() !== 'ls' && command.trim() !== 'dir')
      throw new CommandFailure(`${command.trim().split(' ')[0] ?? ''}: command not found`, 'NotSupported')
    if (!r.target.perms.has('list'))
      throw new CommandFailure('NT_STATUS_ACCESS_DENIED listing \\*', 'AccessDenied')
    const date = (at: number) => ctimeDate(at, LAB_EPOCH_MS)
    const now = date(ctx.state.clock)
    ctx.writeLines([
      `  ${'.'.padEnd(36)}D        0  ${now}`,
      `  ${'..'.padEnd(36)}D        0  ${now}`,
      ...lsEntries(ctx, r.target).map(
        (e) => `  ${e.name.padEnd(36)}${e.folder ? 'D' : 'A'}${String(e.size).padStart(9)}  ${date(e.at)}`
      ),
      '',
      '\t\t52428800 blocks of size 1024. 41943040 blocks available'
    ])
  }
}

export const filesBashTools: ToolDef[] = [
  mountTool,
  umountTool,
  smbclientTool,
  lsTool,
  touchTool,
  mkdirTool,
  catTool
]
