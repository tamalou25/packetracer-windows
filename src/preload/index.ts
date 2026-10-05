/**
 * Preload : seul pont entre le renderer (isolé, sandboxé) et le process principal.
 * N'expose qu'une API minimale et typée ; aucun accès Node ou disque générique.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type MenuCommandMessage, type MenuState, type ServerLabApi } from '../shared/ipc'

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
  setMenuState: (state: MenuState) => ipcRenderer.send(IPC.menuState, state),
  onMenuCommand: (cb) => subscribe<MenuCommandMessage>(IPC.menuCommand, cb)
}

contextBridge.exposeInMainWorld('serverlab', api)
