/**
 * Contrat IPC partagé entre le process principal, le preload et le renderer.
 * Toute nouvelle communication doit être déclarée ici (canaux + types).
 */

/** Commandes émises par la barre de menu native vers le renderer. */
export type MenuCommand =
  | 'file:new'
  | 'file:open'
  | 'file:save'
  | 'file:saveAs'
  | 'file:openRecent'
  | 'file:openLab'
  | 'edit:undo'
  | 'edit:redo'
  | 'edit:copy'
  | 'edit:paste'
  | 'edit:delete'
  | 'edit:selectAll'
  | 'view:zoomIn'
  | 'view:zoomOut'
  | 'view:fit'
  | 'view:togglePortLabels'
  | 'view:toggleProperties'
  | 'view:theme'
  | 'sim:realtime'
  | 'sim:simulation'
  | 'sim:step'
  | 'sim:play'
  | 'sim:reset'
  | 'help:shortcuts'
  | 'help:guide'

export interface MenuCommandMessage {
  command: MenuCommand
  /** Argument optionnel (ex. chemin d'un fichier récent). */
  arg?: string
}

/** Thème de l'interface (sombre par défaut). */
export type Theme = 'dark' | 'light'

export const THEMES: readonly Theme[] = ['dark', 'light']

/** Argument de ligne de commande transmis au preload pour appliquer le thème dès le chargement. */
export const THEME_ARG_PREFIX = '--serverlab-theme='

/** Mode de simulation, comme dans les simulateurs réseau classiques. */
export type SimMode = 'realtime' | 'simulation'

/** État de l'UI que le renderer pousse vers le main pour mettre à jour le menu. */
export interface MenuState {
  mode: SimMode
  showPortLabels: boolean
  showProperties: boolean
}

/** Informations sur l'application. */
export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  platform: string
  isPackaged: boolean
}

/** Fichier ouvert (contenu brut, validé ensuite par le moteur côté renderer). */
export interface OpenedFile {
  path: string
  name: string
  content: string
}

/** Résultat d'une opération fichier. */
export type FileResult<T> = { ok: true; value: T } | { ok: false; canceled?: boolean; error?: string }

/** Entrée de la liste des fichiers récents. */
export interface RecentFile {
  path: string
  name: string
  openedAt: string
}

/** Réponse à la question « Enregistrer les modifications ? ». */
export type SaveChangesChoice = 'save' | 'discard' | 'cancel'

/** Noms des canaux IPC (une seule définition pour éviter les fautes de frappe). */
export const IPC = {
  appInfo: 'app:info',
  menuCommand: 'menu:command',
  menuState: 'menu:state',
  themeSet: 'theme:set',
  fileOpen: 'file:open',
  fileOpenRecent: 'file:openRecent',
  fileSave: 'file:save',
  fileSaveAs: 'file:saveAs',
  fileOpened: 'file:opened',
  filePending: 'file:pending',
  recentList: 'recent:list',
  recentClear: 'recent:clear',
  autosaveWrite: 'autosave:write',
  autosaveClear: 'autosave:clear',
  autosaveRecover: 'autosave:recover',
  docState: 'doc:state',
  askSaveChanges: 'doc:askSaveChanges',
  closeRequested: 'app:closeRequested',
  closeConfirmed: 'app:closeConfirmed',
  updateCheck: 'update:check',
  updateStatus: 'update:status'
} as const

/** Taille maximale acceptée pour un fichier .slab (protection contre les fichiers aberrants). */
export const MAX_SLAB_BYTES = 20 * 1024 * 1024

/** API exposée au renderer via contextBridge (window.serverlab). */
export interface ServerLabApi {
  appInfo(): Promise<AppInfo>
  /** Thème enregistré, connu dès le chargement (évite un flash de couleurs). */
  readonly initialTheme: Theme
  /** Demande un changement de thème : le main l'enregistre puis renvoie la commande `view:theme`. */
  setTheme(theme: Theme): void
  setMenuState(state: MenuState): void
  onMenuCommand(cb: (msg: MenuCommandMessage) => void): () => void

  /** Dialogue natif d'ouverture d'un fichier .slab. */
  openFile(): Promise<FileResult<OpenedFile>>
  /** Ouvre un fichier de la liste des récents. */
  openRecent(path: string): Promise<FileResult<OpenedFile>>
  /** Enregistre à un emplacement déjà connu (ouvert ou enregistré pendant la session). */
  saveFile(path: string, content: string): Promise<FileResult<string>>
  /** Dialogue natif « Enregistrer sous ». Renvoie le chemin choisi. */
  saveFileAs(content: string, suggestedName: string): Promise<FileResult<string>>
  /** Fichier passé au lancement (double-clic sur un .slab), à ouvrir au démarrage. */
  getPendingFile(): Promise<OpenedFile | null>
  /** Fichier ouvert depuis l'extérieur alors que l'application tourne déjà. */
  onFileOpened(cb: (file: OpenedFile) => void): () => void

  /** Écrit le fichier de récupération (autosave). */
  writeAutosave(content: string): Promise<void>
  clearAutosave(): Promise<void>
  /** Contenu de récupération laissé par une session interrompue, ou null. */
  recoverAutosave(): Promise<string | null>

  /** Informe le main de l'état du document (titre, modifications non enregistrées). */
  setDocumentState(state: { name: string; dirty: boolean }): void
  /** Dialogue natif « Enregistrer les modifications ? ». */
  askSaveChanges(docName: string): Promise<SaveChangesChoice>
  /** Le main demande d'enregistrer avant fermeture. */
  onCloseRequested(cb: () => void): () => void
  /** Confirme que la fermeture peut avoir lieu (après enregistrement). */
  confirmClose(): void
}
