/**
 * Point d'entrée du process principal Electron.
 * Crée la fenêtre sécurisée, le menu natif et enregistre les handlers IPC.
 */
import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import { join } from 'node:path'
import { IPC, type AppInfo, type MenuState } from '../shared/ipc'
import { buildMenu } from './menu'
import { applyGlobalSecurity } from './security'
import { isMenuState } from './validate'

// Permet aux tests E2E d'isoler les données utilisateur (récents, autosave) dans un dossier temporaire
const userDataOverride = process.env['SERVERLAB_USER_DATA']
if (userDataOverride) app.setPath('userData', userDataOverride)

let mainWindow: BrowserWindow | null = null
let menuState: MenuState = { mode: 'realtime', showPortLabels: false, showProperties: true }

/** Reconstruit le menu natif à partir de l'état courant. */
function refreshMenu(): void {
  if (!mainWindow) return
  Menu.setApplicationMenu(buildMenu({ window: mainWindow, state: menuState, recent: [] }))
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'ServerLab',
    backgroundColor: '#f1f5f9',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win.show())

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

function registerIpc(): void {
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
}

app.setName('ServerLab')

app.whenReady().then(() => {
  applyGlobalSecurity()
  registerIpc()
  mainWindow = createWindow()
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  refreshMenu()
})

app.on('window-all-closed', () => {
  app.quit()
})
