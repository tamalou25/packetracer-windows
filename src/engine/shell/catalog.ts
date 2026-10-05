/**
 * Catalogue des commandes des consoles simulées.
 * Pour ajouter une cmdlet : la déclarer dans ps/cmdlets/<domaine>.ts puis l'ajouter ici.
 */
import type { CommandCatalog } from './ps/interpreter'
import { adCmdlets } from '../roles/adds/cmdlets'
import { coreCmdlets } from './ps/cmdlets/core'
import { dhcpCmdlets } from '../roles/dhcp/cmdlets'
import { dnsCmdlets } from '../roles/dns/cmdlets'
import { fileCmdlets } from '../roles/files/cmdlets'
import { gpoCmdlets } from '../roles/gpo/cmdlets'
import { netCmdlets } from './ps/cmdlets/net'
import { systemCmdlets } from './ps/cmdlets/system'
import { nslookupTool } from '../roles/dns/tools'
import { fileTools } from '../roles/files/tools'
import { gpresultTool, gpupdateTool } from '../roles/gpo/tools'
import { hostnameTool, ipconfigTool, pingTool, tracertTool, whoamiTool } from './tools/net'

export const CATALOG: CommandCatalog = {
  cmdlets: [
    ...coreCmdlets,
    ...netCmdlets,
    ...systemCmdlets,
    ...dhcpCmdlets,
    ...dnsCmdlets,
    ...adCmdlets,
    ...gpoCmdlets,
    ...fileCmdlets
  ],
  tools: [
    ipconfigTool,
    pingTool,
    tracertTool,
    nslookupTool,
    hostnameTool,
    whoamiTool,
    gpupdateTool,
    gpresultTool,
    ...fileTools
  ]
}
