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

/** Noms des canaux IPC (une seule définition pour éviter les fautes de frappe). */
export const IPC = {
  appInfo: 'app:info',
  menuCommand: 'menu:command',
  menuState: 'menu:state',
  fileOpen: 'file:open',
  fileOpenPath: 'file:openPath',
  fileSave: 'file:save',
  fileSaveAs: 'file:saveAs',
  fileOpened: 'file:opened',
  recentList: 'recent:list',
  recentClear: 'recent:clear',
  autosaveWrite: 'autosave:write',
  autosaveClear: 'autosave:clear',
  autosaveRecover: 'autosave:recover',
  docDirty: 'doc:dirty',
  closeRequested: 'app:closeRequested',
  closeConfirmed: 'app:closeConfirmed',
  updateCheck: 'update:check',
  updateStatus: 'update:status'
} as const

/** API exposée au renderer via contextBridge (window.serverlab). */
export interface ServerLabApi {
  appInfo(): Promise<AppInfo>
  setMenuState(state: MenuState): void
  onMenuCommand(cb: (msg: MenuCommandMessage) => void): () => void
}
