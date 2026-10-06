/**
 * Gestion des fichiers .slab côté process principal :
 * dialogues natifs, lecture/écriture, fichiers récents, autosave de récupération.
 *
 * Sécurité : le renderer ne peut lire/écrire qu'un chemin obtenu via un dialogue natif,
 * passé par le système (double-clic sur un .slab) ou présent dans la liste des récents.
 */
import { app, dialog, type BrowserWindow } from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { MAX_SLAB_BYTES, type FileResult, type OpenedFile, type RecentFile } from '../shared/ipc'
import { MAX_RECENT, parseRecentFiles } from '../shared/persisted'

const SLAB_FILTERS = [{ name: 'Lab ServerLab', extensions: ['slab'] }]

/** Clé de comparaison d'un chemin (insensible à la casse sous Windows). */
function pathKey(path: string): string {
  const abs = resolve(path)
  return process.platform === 'win32' ? abs.toLowerCase() : abs
}

export function isSlabPath(path: string): boolean {
  return extname(path).toLowerCase() === '.slab'
}

/** Cherche un chemin .slab existant dans les arguments de la ligne de commande. */
export function findSlabArg(argv: string[]): string | null {
  for (const arg of argv.slice(1)) {
    if (!arg.startsWith('-') && isSlabPath(arg) && existsSync(arg)) return resolve(arg)
  }
  return null
}

/** Écriture atomique : fichier temporaire puis renommage (évite un fichier tronqué en cas de crash). */
async function writeAtomic(path: string, content: string): Promise<void> {
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`)
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, path)
}

function errorMessage(e: unknown): string {
  const code = (e as NodeJS.ErrnoException | undefined)?.code
  switch (code) {
    case 'ENOENT':
      return 'Fichier introuvable.'
    case 'EACCES':
    case 'EPERM':
      return 'Accès refusé : vérifiez les droits sur ce fichier ou ce dossier.'
    case 'ENOSPC':
      return 'Espace disque insuffisant.'
    default:
      return e instanceof Error ? e.message : 'Erreur inconnue.'
  }
}

export class FileService {
  private readonly authorized = new Set<string>()
  private recent: RecentFile[] = []
  private pending: OpenedFile | null = null

  constructor(private readonly onRecentChanged: () => void) {}

  private get recentPath(): string {
    return join(app.getPath('userData'), 'recent.json')
  }

  private get autosavePath(): string {
    return join(app.getPath('userData'), 'autosave', 'recovery.slab')
  }

  async init(): Promise<void> {
    try {
      // Entrées invalides écartées une à une (RecentFileSchema)
      this.recent = parseRecentFiles(await fs.readFile(this.recentPath, 'utf8'))
    } catch {
      this.recent = []
    }
  }

  /** Récents dont le fichier existe encore. */
  recentFiles(): RecentFile[] {
    return this.recent.filter((r) => existsSync(r.path))
  }

  async clearRecent(): Promise<void> {
    this.recent = []
    await this.persistRecent()
  }

  private async persistRecent(): Promise<void> {
    try {
      await fs.mkdir(dirname(this.recentPath), { recursive: true })
      await fs.writeFile(this.recentPath, JSON.stringify(this.recent, null, 2), 'utf8')
    } catch {
      // Non bloquant : la liste des récents est un confort
    }
    this.onRecentChanged()
  }

  private async remember(path: string): Promise<void> {
    const abs = resolve(path)
    this.authorized.add(pathKey(abs))
    const key = pathKey(abs)
    this.recent = [
      { path: abs, name: basename(abs), openedAt: new Date().toISOString() },
      ...this.recent.filter((r) => pathKey(r.path) !== key)
    ].slice(0, MAX_RECENT)
    app.addRecentDocument(abs)
    await this.persistRecent()
  }

  private isAllowed(path: string): boolean {
    const key = pathKey(path)
    return this.authorized.has(key) || this.recent.some((r) => pathKey(r.path) === key)
  }

  /** Lit un fichier .slab (contrôle d'extension et de taille). */
  private async read(path: string): Promise<FileResult<OpenedFile>> {
    if (!isSlabPath(path)) return { ok: false, error: 'Seuls les fichiers .slab peuvent être ouverts.' }
    try {
      const stat = await fs.stat(path)
      if (stat.size > MAX_SLAB_BYTES)
        return { ok: false, error: 'Fichier trop volumineux pour un lab ServerLab.' }
      const content = await fs.readFile(path, 'utf8')
      await this.remember(path)
      return { ok: true, value: { path: resolve(path), name: basename(path), content } }
    } catch (e) {
      return { ok: false, error: errorMessage(e) }
    }
  }

  async openDialog(win: BrowserWindow): Promise<FileResult<OpenedFile>> {
    const res = await dialog.showOpenDialog(win, {
      title: 'Ouvrir un lab',
      filters: SLAB_FILTERS,
      properties: ['openFile']
    })
    const path = res.filePaths[0]
    if (res.canceled || !path) return { ok: false, canceled: true }
    return this.read(path)
  }

  async openRecent(path: unknown): Promise<FileResult<OpenedFile>> {
    if (typeof path !== 'string' || !this.isAllowed(path)) {
      return { ok: false, error: 'Ce fichier ne fait pas partie des fichiers récents.' }
    }
    return this.read(path)
  }

  /** Ouvre un fichier transmis par le système (argument de lancement ou seconde instance). */
  async openExternal(path: string): Promise<FileResult<OpenedFile>> {
    this.authorized.add(pathKey(path))
    return this.read(path)
  }

  async save(path: unknown, content: unknown): Promise<FileResult<string>> {
    if (typeof path !== 'string' || typeof content !== 'string')
      return { ok: false, error: 'Paramètres invalides.' }
    if (!isSlabPath(path) || !this.isAllowed(path)) {
      return { ok: false, error: 'Emplacement non autorisé : utilisez « Enregistrer sous ».' }
    }
    if (Buffer.byteLength(content, 'utf8') > MAX_SLAB_BYTES)
      return { ok: false, error: 'Document trop volumineux.' }
    try {
      await writeAtomic(path, content)
      await this.remember(path)
      return { ok: true, value: resolve(path) }
    } catch (e) {
      return { ok: false, error: errorMessage(e) }
    }
  }

  async saveAs(win: BrowserWindow, content: unknown, suggestedName: unknown): Promise<FileResult<string>> {
    if (typeof content !== 'string') return { ok: false, error: 'Paramètres invalides.' }
    const safeName =
      typeof suggestedName === 'string' && /^[^\\/:*?"<>|]{1,80}$/.test(suggestedName)
        ? suggestedName
        : 'Sans titre'
    const res = await dialog.showSaveDialog(win, {
      title: 'Enregistrer le lab',
      defaultPath: join(app.getPath('documents'), `${safeName.replace(/\.slab$/i, '')}.slab`),
      filters: SLAB_FILTERS
    })
    if (res.canceled || !res.filePath) return { ok: false, canceled: true }
    const path = isSlabPath(res.filePath) ? res.filePath : `${res.filePath}.slab`
    this.authorized.add(pathKey(path))
    return this.save(path, content)
  }

  setPending(file: OpenedFile | null): void {
    this.pending = file
  }

  takePending(): OpenedFile | null {
    const file = this.pending
    this.pending = null
    return file
  }

  async writeAutosave(content: unknown): Promise<void> {
    if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_SLAB_BYTES) return
    await fs.mkdir(dirname(this.autosavePath), { recursive: true })
    await writeAtomic(this.autosavePath, content)
  }

  async clearAutosave(): Promise<void> {
    await fs.rm(this.autosavePath, { force: true })
  }

  async recoverAutosave(): Promise<string | null> {
    try {
      // Fichier de récupération aberrant (taille) : ignoré, comme un .slab ouvert par l'utilisateur
      if ((await fs.stat(this.autosavePath)).size > MAX_SLAB_BYTES) return null
      return await fs.readFile(this.autosavePath, 'utf8')
    } catch {
      return null
    }
  }
}
