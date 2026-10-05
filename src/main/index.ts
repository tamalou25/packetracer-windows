/**
 * Point d'entrée du process principal Electron.
 * Crée la fenêtre sécurisée, le menu natif et enregistre les handlers IPC.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme } from 'electron'
import { join } from 'node:path'
import {
  IPC,
  THEME_ARG_PREFIX,
  type AppInfo,
  type MenuState,
  type SaveChangesChoice,
  type Theme
} from '../shared/ipc'
import { FileService, findSlabArg } from './files'
import { buildMenu } from './menu'
import { applyGlobalSecurity } from './security'
import { isTheme, loadSettings, saveSettings, THEME_BACKGROUND, type Settings } from './settings'
import { isDocState, isMenuState } from './validate'

// Permet aux tests E2E d'isoler les données utilisateur (récents, autosave) dans un dossier temporaire
const userDataOverride = process.env['SERVERLAB_USER_DATA']
if (userDataOverride) app.setPath('userData', userDataOverride)

// Une seule instance : un double-clic sur un .slab est transmis à la fenêtre existante
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let mainWindow: BrowserWindow | null = null
let menuState: MenuState = { mode: 'realtime', showPortLabels: false, showProperties: true }
let docState = { name: 'Sans titre', dirty: false }
/** Préférences chargées au démarrage (après le choix éventuel du dossier userData). */
let settings: Settings = { theme: 'dark' }
/** Vrai quand la fermeture a été confirmée (évite de redemander). */
let closeConfirmed = false

const files = new FileService(() => refreshMenu())

/** Reconstruit le menu natif à partir de l'état courant. */
function refreshMenu(): void {
  if (!mainWindow) return
  Menu.setApplicationMenu(
    buildMenu({
      window: mainWindow,
      state: menuState,
      recent: files.recentFiles(),
      theme: settings.theme,
      onTheme: applyTheme
    })
  )
}

/**
 * Applique et enregistre le thème : barre de titre et dialogues natifs (nativeTheme),
 * fond de la fenêtre, menu, puis le renderer via la commande `view:theme`.
 */
function applyTheme(theme: Theme): void {
  settings = { ...settings, theme }
  saveSettings(settings)
  nativeTheme.themeSource = theme
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(THEME_BACKGROUND[theme])
    mainWindow.webContents.send(IPC.menuCommand, { command: 'view:theme', arg: theme })
  }
  refreshMenu()
}

async function askSaveChanges(win: BrowserWindow, name: string): Promise<SaveChangesChoice> {
  const res = await dialog.showMessageBox(win, {
    type: 'warning',
    title: 'ServerLab',
    message: `Voulez-vous enregistrer les modifications apportées à « ${name} » ?`,
    detail: 'Vos modifications seront perdues si vous ne les enregistrez pas.',
    buttons: ['Enregistrer', 'Ne pas enregistrer', 'Annuler'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  })
  return res.response === 0 ? 'save' : res.response === 1 ? 'discard' : 'cancel'
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'ServerLab',
    backgroundColor: THEME_BACKGROUND[settings.theme],
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Thème connu dès le chargement du preload (pas de flash de couleurs)
      additionalArguments: [`${THEME_ARG_PREFIX}${settings.theme}`],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // Confirmation avant fermeture si le document a été modifié
  win.on('close', (event) => {
    if (closeConfirmed || !docState.dirty) {
      void files.clearAutosave()
      return
    }
    event.preventDefault()
    void askSaveChanges(win, docState.name).then((choice) => {
      if (choice === 'save') {
        // Le renderer enregistre puis appelle confirmClose()
        win.webContents.send(IPC.closeRequested)
      } else if (choice === 'discard') {
        closeConfirmed = true
        win.close()
      }
    })
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

function registerIpc(): void {
  const win = (): BrowserWindow => {
    if (!mainWindow) throw new Error('Fenêtre principale indisponible')
    return mainWindow
  }

  ipcMain.handle(IPC.appInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    isPackaged: app.isPackaged
  }))

  ipcMain.on(IPC.menuState, (_event, state: unknown) => {
    if (!isMenuState(state)) return
    menuState = state
    refreshMenu()
  })

  ipcMain.on(IPC.themeSet, (_event, theme: unknown) => {
    if (isTheme(theme)) applyTheme(theme)
  })

  ipcMain.on(IPC.docState, (_event, state: unknown) => {
    if (isDocState(state)) docState = state
  })

  ipcMain.handle(IPC.fileOpen, () => files.openDialog(win()))
  ipcMain.handle(IPC.fileOpenRecent, (_e, path: unknown) => files.openRecent(path))
  ipcMain.handle(IPC.fileSave, (_e, path: unknown, content: unknown) => files.save(path, content))
  ipcMain.handle(IPC.fileSaveAs, (_e, content: unknown, name: unknown) => files.saveAs(win(), content, name))
  ipcMain.handle(IPC.filePending, () => files.takePending())
  ipcMain.handle(IPC.recentList, () => files.recentFiles())
  ipcMain.handle(IPC.recentClear, () => files.clearRecent())

  ipcMain.handle(IPC.autosaveWrite, (_e, content: unknown) => files.writeAutosave(content))
  ipcMain.handle(IPC.autosaveClear, () => files.clearAutosave())
  ipcMain.handle(IPC.autosaveRecover, () => files.recoverAutosave())

  ipcMain.handle(IPC.askSaveChanges, (_e, name: unknown) =>
    askSaveChanges(win(), typeof name === 'string' ? name.slice(0, 200) : 'Sans titre')
  )
  ipcMain.on(IPC.closeConfirmed, () => {
    closeConfirmed = true
    mainWindow?.close()
  })
}

/** Ouvre un .slab transmis par le système dans la fenêtre existante. */
async function openFromSystem(path: string): Promise<void> {
  const res = await files.openExternal(path)
  if (!mainWindow) return
  if (res.ok) mainWindow.webContents.send(IPC.fileOpened, res.value)
  else dialog.showErrorBox('Ouverture impossible', res.error ?? 'Erreur inconnue.')
}

app.on('second-instance', (_event, argv) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
  const path = findSlabArg(argv)
  if (path) void openFromSystem(path)
})

app.setName('ServerLab')

app.whenReady().then(async () => {
  applyGlobalSecurity()
  settings = loadSettings()
  nativeTheme.themeSource = settings.theme
  await files.init()
  registerIpc()

  // Fichier passé au lancement (association de l'extension .slab)
  const initial = findSlabArg(process.argv)
  if (initial) {
    const res = await files.openExternal(initial)
    if (res.ok) files.setPending(res.value)
  }

  mainWindow = createWindow()
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  refreshMenu()
})

app.on('window-all-closed', () => {
  app.quit()
})
