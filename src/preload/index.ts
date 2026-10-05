/**
 * Preload : seul pont entre le renderer (isolé, sandboxé) et le process principal.
 * N'expose qu'une API minimale et typée ; aucun accès Node ou disque générique.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type MenuCommandMessage, type OpenedFile, type ServerLabApi } from '../shared/ipc'

/** Abonne un callback à un canal et renvoie une fonction de désabonnement. */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: ServerLabApi = {
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  setMenuState: (state) => ipcRenderer.send(IPC.menuState, state),
  onMenuCommand: (cb) => subscribe<MenuCommandMessage>(IPC.menuCommand, cb),

  openFile: () => ipcRenderer.invoke(IPC.fileOpen),
  openRecent: (path) => ipcRenderer.invoke(IPC.fileOpenRecent, path),
  saveFile: (path, content) => ipcRenderer.invoke(IPC.fileSave, path, content),
  saveFileAs: (content, suggestedName) => ipcRenderer.invoke(IPC.fileSaveAs, content, suggestedName),
  getPendingFile: () => ipcRenderer.invoke(IPC.filePending),
  onFileOpened: (cb) => subscribe<OpenedFile>(IPC.fileOpened, cb),

  writeAutosave: (content) => ipcRenderer.invoke(IPC.autosaveWrite, content),
  clearAutosave: () => ipcRenderer.invoke(IPC.autosaveClear),
  recoverAutosave: () => ipcRenderer.invoke(IPC.autosaveRecover),

  setDocumentState: (state) => ipcRenderer.send(IPC.docState, state),
  askSaveChanges: (docName) => ipcRenderer.invoke(IPC.askSaveChanges, docName),
  onCloseRequested: (cb) => subscribe<void>(IPC.closeRequested, () => cb()),
  confirmClose: () => ipcRenderer.send(IPC.closeConfirmed)
}

contextBridge.exposeInMainWorld('serverlab', api)
