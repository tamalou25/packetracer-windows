/**
 * Catalogue des commandes des consoles simulées.
 * Pour ajouter une cmdlet : la déclarer dans ps/cmdlets/<domaine>.ts puis l'ajouter ici.
 */
import type { CommandCatalog } from './ps/interpreter'
import { coreCmdlets } from './ps/cmdlets/core'
import { netCmdlets } from './ps/cmdlets/net'
import { systemCmdlets } from './ps/cmdlets/system'
import { hostnameTool, ipconfigTool, pingTool, tracertTool, whoamiTool } from './tools/net'

export const CATALOG: CommandCatalog = {
  cmdlets: [...coreCmdlets, ...netCmdlets, ...systemCmdlets],
  tools: [ipconfigTool, pingTool, tracertTool, hostnameTool, whoamiTool]
}
