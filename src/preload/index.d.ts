import type { ServerLabApi } from '../shared/ipc'

declare global {
  interface Window {
    /** API exposée par le preload (voir src/preload/index.ts). */
    serverlab: ServerLabApi
  }
}

export {}
