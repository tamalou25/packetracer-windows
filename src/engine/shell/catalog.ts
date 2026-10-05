/**
 * Catalogue des commandes des consoles simulées.
 * Pour ajouter une cmdlet : la déclarer dans ps/cmdlets/<domaine>.ts puis l'ajouter ici.
 */
import type { CommandCatalog } from './ps/interpreter'
import { adCmdlets } from './ps/cmdlets/ad'
import { coreCmdlets } from './ps/cmdlets/core'
import { dhcpCmdlets } from './ps/cmdlets/dhcp'
import { dnsCmdlets } from './ps/cmdlets/dns'
import { gpoCmdlets } from './ps/cmdlets/gpo'
import { netCmdlets } from './ps/cmdlets/net'
import { systemCmdlets } from './ps/cmdlets/system'
import { nslookupTool } from './tools/dns'
import { gpresultTool, gpupdateTool } from './tools/gpo'
import { hostnameTool, ipconfigTool, pingTool, tracertTool, whoamiTool } from './tools/net'

export const CATALOG: CommandCatalog = {
  cmdlets: [
    ...coreCmdlets,
    ...netCmdlets,
    ...systemCmdlets,
    ...dhcpCmdlets,
    ...dnsCmdlets,
    ...adCmdlets,
    ...gpoCmdlets
  ],
  tools: [
    ipconfigTool,
    pingTool,
    tracertTool,
    nslookupTool,
    hostnameTool,
    whoamiTool,
    gpupdateTool,
    gpresultTool
  ]
}
